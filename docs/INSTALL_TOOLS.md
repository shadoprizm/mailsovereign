# Prepare your computer
This guide prepares a Mac or Ubuntu computer to install Sovereign Mail on Cloudflare.
The computer runs the installer; the mail service runs on Cloudflare afterward.

## What the tools do
| Tool | Purpose |
| --- | --- |
| Terminal / command line | A window where you type instructions and read results. |
| Git | Downloads a particular version of Sovereign Mail. |
| Node.js | Runs the installer and build tools. This project requires version 24. |
| npm | Comes with Node.js; installs pnpm below. |
| pnpm | Downloads the project's dependencies and runs its named commands. Use 11.7.0. |
| Wrangler | Cloudflare's command-line tool. The project installs its own copy. |

Run each command separately. Copy only text inside a code block, not its surrounding marks.
Press Enter, wait for it to finish, and stop at an error. A new prompt normally means the
command finished. Commands below target macOS Terminal or Ubuntu's Bash, not Windows PowerShell.

## 1. Open Terminal and install Git
On macOS, open Spotlight with Command-Space, type Terminal, and open it. Run:
```sh
git --version
```
If macOS offers Command Line Tools, install them, reopen Terminal, and retry.
If no prompt appears and Git is missing, run `xcode-select --install`.

On Ubuntu, open Terminal with Ctrl-Alt-T. Run each command:
```sh
sudo apt update
sudo apt install git
git --version
```
Ubuntu may ask for your computer password. Password characters are not displayed.
Success: Git prints a version.

## 2. Install Node.js 24
Open the [official Node.js download page](https://nodejs.org/en/download).
Select version 24 and your operating system; follow the installation instructions shown there.
On macOS, use the version-24 macOS installer. On Ubuntu, use the site's version-manager
instructions for version 24. Follow any instruction to reopen Terminal or load the version manager.
Do not substitute Ubuntu's default Node package without checking its version.

Open a fresh Terminal and run:
```sh
node --version
npm --version
```
Success: Node prints `v24.` followed by its minor and patch numbers; npm prints a version.
If Node prints another major version, select version 24 in your version manager before continuing.

## 3. Install the pinned pnpm version
```sh
npm install --global pnpm@11.7.0
pnpm --version
```
Success: pnpm prints `11.7.0`.
If installation reports EACCES or permission denied, use the Node version-manager approach
in the Node/npm instructions rather than adding sudo to the package command.
If the shell cannot find a newly installed tool, reopen Terminal and retry its version check.

## 4. Download the release and its dependencies
Choose an empty working folder. In Terminal, `pwd` shows your current folder and
`ls` lists its contents. The following creates a new `mailsovereign` folder there:
```sh
git clone --branch v1.2.1 --depth 1 https://github.com/shadoprizm/mailsovereign.git
cd mailsovereign
pnpm install --frozen-lockfile
pnpm exec wrangler --version
```
Use the release named by [production installation](INSTALLATION.md) if this example changes.
The dependency installation downloads packages and runs any allowed installation scripts.
Success: dependency installation completes without an error and Wrangler prints its version.
If the folder already exists, do not delete it or overwrite a previous deployment.
Choose another empty parent folder instead.

## 5. Authorize the installer
```sh
pnpm exec wrangler login
pnpm exec wrangler whoami
```
Login opens Cloudflare in a browser. Sign in and review the permissions before authorizing.
Success: whoami identifies your intended account. If you have several accounts, record the
correct account ID privately and confirm the installer uses that account before creating resources.

This login authorizes the command-line installer. The application also needs its own OAuth
registration, covered in [Cloudflare OAuth setup](CLOUDFLARE_OAUTH_SETUP.md).
Return to [first installation](FIRST_INSTALL.md).

## Troubleshooting
| Symptom | Check / next step |
| --- | --- |
| command not found | Install that tool, reopen Terminal, rerun its version check. |
| No package.json / no importer manifest | Run `pwd` and `ls`; use `cd mailsovereign` from its parent folder. |
| Destination already exists | Use a new parent folder; preserve existing deployment files. |
| Dependency or lockfile error | Confirm Node 24, pnpm 11.7.0, and the release checkout. Preserve the error; do not regenerate the lockfile. |
| Login does not open the browser | Follow Wrangler's displayed login instructions; do not post login links or tokens publicly. |

For an email or community help request, include OS, release, tool versions, failed command with
private values removed, and the error text. Never include API keys, tokens, mailbox data,
deployment manifests, or credential files.

Sources: [Node/npm installation](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/),
[pnpm installation](https://pnpm.io/installation/).
