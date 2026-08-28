# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Scope

DM NOTE uses Authenticode signing for the Windows application executable built by the official [`DmNote-App/DmNote`](https://github.com/DmNote-App/DmNote) repository.

The same signed executable is distributed in two forms:

- `DM.NOTE.exe`, used by the in-app Windows updater
- `dm-note.exe` inside `DM.NOTE.v.<version>.zip`, used for portable installations

The two files differ only by filename and have identical contents. The portable ZIP also contains the same set of CSS and plugin examples as the previous Windows release, plus the third-party notice for the current build. These additional text assets are not signed with the DM NOTE signing policy.

## Build and approval process

1. GitHub Actions builds the executable from the official repository on a GitHub-hosted Windows runner.
2. The unsigned executable is uploaded as a GitHub Actions artifact and submitted through the SignPath GitHub integration with verified origin information.
3. SignPath applies the configured product name and version restrictions and signs the executable.
4. A project approver manually approves each production signing request.
5. The signed executable is placed in both Windows release formats before the draft GitHub Release is published.

Test-signed artifacts use a self-signed certificate and are never published as releases.

## Team roles

- Committers and reviewers: [DM NOTE organization members](https://github.com/orgs/DmNote-App/people)
- Approvers: [DM NOTE organization owners](https://github.com/orgs/DmNote-App/people?query=role%3Aowner)

Team members with repository or signing access are required to use multi-factor authentication for GitHub and SignPath.

## Privacy policy and network communication

DM NOTE does not include analytics or telemetry and does not send personal information to DM NOTE-operated servers.

The application may make the following network connections:

- It requests public release metadata from the GitHub API to check for updates.
- When the user starts an automatic update, it downloads release assets from GitHub Releases.
- User-configured CSS, fonts, or plugins may request resources from URLs selected by the user.
- OBS mode starts a local or LAN WebSocket bridge only when the user enables it.

## Verification

On Windows, the Authenticode signature can be inspected with PowerShell:

```powershell
Get-AuthenticodeSignature -LiteralPath .\DM.NOTE.exe | Format-List
```

Production releases must report a valid signature issued under the SignPath Foundation certificate before publication.
