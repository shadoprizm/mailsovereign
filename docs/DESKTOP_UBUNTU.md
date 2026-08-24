# Ubuntu desktop client

Sovereign Mail publishes an x86-64 Ubuntu `.deb` package and an AppImage with each supported stable
release. The desktop client connects to an existing Sovereign Mail deployment. It does not replace
the Cloudflare installation or copy the deployment's database, mail objects, or infrastructure
credentials onto the workstation.

## Install the `.deb`

Download `sovereign-mail-desktop-<version>-ubuntu-amd64.deb` from the canonical GitHub release, then
install it with Ubuntu's package installer or:

```sh
sudo apt install ./sovereign-mail-desktop-<version>-ubuntu-amd64.deb
```

Launch **Sovereign Mail** from the application menu. On first launch, enter the canonical HTTPS URL
of the deployment, such as `https://mail.example.com`. Use **Sovereign Mail → Change Server…** to
connect the client to a different deployment.

## Use the AppImage

The AppImage is a portable alternative when installing a Debian package is undesirable:

```sh
chmod +x sovereign-mail-desktop-<version>-ubuntu-x86_64.AppImage
./sovereign-mail-desktop-<version>-ubuntu-x86_64.AppImage
```

Both packages contain the same desktop client. Ubuntu 22.04 and 24.04 on x86-64 are the supported
targets for the first desktop release.

## Verify a download

The release's signed `stable.json` records the filename, URL, byte size, and SHA-256 digest of every
desktop artifact. Compare the downloaded file with the matching digest in that manifest before
installing it. Only packages published in the canonical
[`shadoprizm/mailsovereign`](https://github.com/shadoprizm/mailsovereign/releases) release channel
are supported.

The release also includes a convenient checksum file for both Ubuntu downloads:

```sh
sha256sum --check sovereign-mail-desktop-<version>-ubuntu.sha256
```

## Security boundary

The configured server address must use HTTPS. Remote pages run with Node.js integration disabled,
context isolation enabled, and Chromium sandboxing enabled. Cloudflare authorization stays inside
the client; unrelated HTTPS and email links open in the default operating-system application.

Authentication cookies and ordinary Chromium site storage remain in the desktop user's local
profile. Uninstalling the package does not remove that profile automatically. Remove the Sovereign
Mail application data from the Ubuntu user profile separately if the workstation is being
decommissioned.
