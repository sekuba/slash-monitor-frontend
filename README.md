# Aztec Slashing Monitor

this is a tool by/for the [slashVeto council](https://github.com/aztec-slash-veto/council/) and the aztec community: it allows you to see slashooors before they execute and provides you with the precomputed payload addresses and a bunch of other info

want to run it locally?
- save [env.example](.env.example) as `.env` (you can change to your own fancy rpcs in there if you like)
- `npm install`
- `npm run dev`

if you run it locally with a sequencer admin api in the env you get the bonus info of 'offense types', knowing why someone is being slashed. this feature is not included in the github pages version and fully optional (just leave out the env if you do not need it)
