# Message-type registry fixtures

One JSON file per supported chain version, listing the type URL of every message the chain app
routes (every `rpc` of every `service Msg` of the modules it wires: the cosmos-sdk modules in
`app/app_config.go`, the IBC modules in `app/ibc.go` and the BZE modules in `x/`).

`src/summarise.test.ts` checks that each listed type is summarised, governance-only
(`src/governance.ts`) or on its explicit trust-tick list. A new type with none of these fails
the test.

**Regenerate these files at every chain upgrade**, from the chain source of the new release and
the cosmos-sdk and ibc-go versions its `go.mod` pins, and add a file when a new version is
supported. Then decide for each new type: summary, governance-only, or the tick.
