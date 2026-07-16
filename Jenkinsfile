pipeline {
	agent {
		label 'macos'
	}

	options {
		withFolderProperties()
	}

	tools {
		// Jenkins NodeJS plugin required
		nodejs 'NodeJS 20'
	}

	stages {
		stage('Check out repository') {
			steps {
				checkout scm
			}
		}

		stage('Install dependencies') {
			steps {
				sh 'npm ci'
			}
		}

		stage('Run tests') {
			steps {
				sh 'npm test'
			}
		}

		stage('Build macOS application and packages') {
			steps {
				withCredentials([
					// Developer ID Application is required for application signature
					certificate(
						credentialsId: 'e7110adb-442a-4fed-a3c7-a0701a748c7d',
						keystoreVariable: 'KEYSTORE_DIR',
						passwordVariable: 'KEYSTORE_PASSWORD',
						aliasVariable: 'KEYSTORE_ALIAS'
					),
					// Developer ID Installer is required for package signature
					certificate(
						credentialsId: '7ef48e68-0fd5-40c7-879a-763f52492ef7',
						keystoreVariable: 'INSTALLER_KEYSTORE_DIR',
						passwordVariable: 'INSTALLER_KEYSTORE_PASSWORD',
						aliasVariable: 'INSTALLER_KEYSTORE_ALIAS'
					),
					// Application Specific Password is required for Apple notarization
					usernamePassword(
						credentialsId: 'ff0682c4-6f38-42dc-86b2-1a1d67487a2a',
						usernameVariable: 'APPLE_ID',
						passwordVariable: 'APPLE_APP_SPECIFIC_PASSWORD'
					)
				]) {
					script {
						env.CSC_LINK = "./${env.KEYSTORE_ALIAS}.p12"
						env.CSC_INSTALLER_LINK = "./${env.INSTALLER_KEYSTORE_ALIAS}.p12"

						def envFileContent = """
APPLE_ID="${env.APPLE_ID}"
APPLE_APP_SPECIFIC_PASSWORD="${env.APPLE_APP_SPECIFIC_PASSWORD}"
APPLE_TEAM_ID="${env.APPLE_TEAM_ID}"
CSC_LINK="${env.CSC_LINK}"
CSC_KEY_PASSWORD="${env.KEYSTORE_PASSWORD}"
CSC_INSTALLER_LINK="${env.CSC_INSTALLER_LINK}"
CSC_INSTALLER_KEY_PASSWORD="${env.INSTALLER_KEYSTORE_PASSWORD}"
"""
						// Create required Electron environment file
						writeFile file: "electron-builder.env", text: envFileContent
					}
					sh '''
						# Copy required PKCS12 files
						cp "${KEYSTORE_DIR}" "./${KEYSTORE_ALIAS}.p12"
						cp "${INSTALLER_KEYSTORE_DIR}" "./${INSTALLER_KEYSTORE_ALIAS}.p12"

						# Application build and archive
						npm run build
						npx electron-builder --mac --publish never
					'''
				}
			}
		}

		stage('Upload build artifacts') {
			steps {
				archiveArtifacts artifacts: 'dist/*.pkg, dist/*.dmg', fingerprint: true, onlyIfSuccessful: true
			}
		}

		stage('Publish artifacts') {
			when {
				buildingTag()
				tag pattern: '^v\\d+\\.\\d+\\.\\d+$', comparator: "REGEXP"
			}
			steps {
				withCredentials([
					string(
						credentialsId: 'b6a6603c-c845-4d9c-b070-fff05e8ebfa7',
						variable: 'GITHUB_TOKEN'
					)
				]) {
					echo "GitHub release for ${env.TAG_NAME} tag..."
					// Curl script in replacement for the 'softprops/action-gh-release' Jenkins action
					sh """
						# 1. Release creation on GitHub
						RELEASE_RESPONSE=\$(curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
							-H "Accept: application/vnd.github.v3+json" \
							-d '{"tag_name": "${env.TAG_NAME}", "name": "Release ${env.TAG_NAME}", "generate_release_notes": true}' \
							"https://api.github.com/repos/${env.GIT_URL.split('github.com/')[1].replace('.git', '')}/releases")

						# Get the release ID or upload URL (upload_url)
						UPLOAD_URL=\$(echo "\$RELEASE_RESPONSE" | grep -o 'https://uploads.github.com/repos/[^"]*' | head -n 1 | sed 's/{?name,label}//')

						if [ -z "\$UPLOAD_URL" ]; then
							echo "Error creating release or getting upload URL."
							echo "\$RELEASE_RESPONSE"
							exit 1
						fi

						# 2. Upload the .pkg files on GitHub release
						for file in dist/*.pkg; do
							FILENAME=\$(basename "\$file")
							echo "Uploading \$FILENAME..."
							curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
								-H "Content-Type: application/octet-stream" \
								--data-binary "@\$file" \
								"\${UPLOAD_URL}?name=\${FILENAME}"
						done
					"""
				}
			}
		}
	}

	post {
		always {
			script {
				def duration = currentBuild.durationString.replace(' and counting', '').replace(' et décompte', '')
				// Make the path separator looks like the default separator
				def jobName = env.JOB_NAME.replace('/', ' » ')
				// URL decode the string, typically the branch name including a path separator
				jobName = java.net.URLDecoder.decode(jobName, "UTF-8")
				def status = currentBuild.currentResult.toLowerCase().capitalize()
				message = "${jobName} - ${env.BUILD_DISPLAY_NAME} ${status} after ${duration} (<${env.BUILD_URL}|Open>)"
			}
			cleanWs()
		}
		success {
			slackSend color: "good", message: "${message}"
		}
		failure {
			slackSend color: "danger", message: "${message}"
			emailext (
				to: '${DEFAULT_RECIPIENTS}',
				subject: '${DEFAULT_SUBJECT}',
				body: '${DEFAULT_CONTENT}'
			)
		}
		unstable {
			slackSend color: "warning", message: "${message}"
		}
		fixed {
			emailext (
				to: '${DEFAULT_RECIPIENTS}',
				subject: '${DEFAULT_SUBJECT}',
				body: '${DEFAULT_CONTENT}'
			)
		}
		aborted {
			slackSend color: "warning", message: "${message}"
		}
	}
}
