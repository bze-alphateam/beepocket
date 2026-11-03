BeePocket {{VERSION}}, the security-first wallet for the BeeZee (BZE) network.

Download BeePocket only from [github.com/bze-alphateam/beepocket](https://github.com/bze-alphateam/beepocket). Copies from anywhere else may be modified to steal your funds.

## Install

1. Download `beepocket-{{VERSION}}.zip` below.
2. Unzip it into a folder you keep. Chrome loads the extension from that folder every time it starts, so don't delete or move it.
3. Open `chrome://extensions`, turn on **Developer mode** and click **Load unpacked**.
4. Pick the folder you unzipped.
5. Check that the extension card shows the ID `ijohiojehlnmpoelmpnnbcfhkpgaclfc`.

## Update

1. Download the new zip and unzip it over the contents of the same folder, replacing the old files.
2. On `chrome://extensions`, click the reload button on the BeePocket card.

Never remove the extension to update it. Removing it deletes the wallet data stored in the browser. Keep your recovery phrase somewhere safe: it is the only way to restore your wallet.

## Verify

Download `SHA256SUMS` next to the zip, then run:

```sh
sha256sum -c SHA256SUMS
gh attestation verify beepocket-{{VERSION}}.zip --repo bze-alphateam/beepocket
```

The first command checks the zip against the published sum. The second checks that the zip was built by this repository's GitHub Actions; the attestation also records the tag and commit it was built from. The build is reproducible: you can rebuild the zip from the tag and compare sums, as described in the README.
