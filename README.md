# Redline

A fast, keyboard-first desktop app for Redmine, in the style of Linear. It
runs natively on macOS and Windows and works with any Redmine server using
your own API key: no admin rights and no plugins.

Redline is in early development, working towards its first release.

## What it does

- Lists your issues, your teams' issues and cycles (Redmine versions), grouped
  and filtered the way Linear does.
- Opens, edits and comments on issues, and creates new ones, from the keyboard
  or the command menu (Cmd+K on macOS, Ctrl+K on Windows).
- Keeps a local copy of what you can see, so lists are instant and work while
  the server is slow, and pulls changes in the background.

The goal is for everything in Redmine to have a place in Redline.
[docs/parity.md](docs/parity.md) tracks each Redmine area, what its API
allows, and where it lives in Redline.

## Supported Redmine versions

Redmine 6.1 and later, with the REST API turned on (Administration > Settings
> API). Older releases aren't supported. See
[ADR 0005](docs/adr/0005-supported-redmine-versions.md).

## Servers behind a proxy or gateway

Some organisations put a reverse proxy or gateway in front of Redmine that
wants more than the API key, such as an `X-Redmine-Username` header or an
access token. On the sign-in screen, open **Advanced** to add:

- **Username**, sent as `X-Redmine-Username` with every request.
- **Custom headers**, any name and value pairs your proxy needs.

Redline sends them with every request to that server (sign-in, sync, uploads
and downloads) and to no other host. It keeps them in the system keychain
with your API key, and never writes them to logs. To change them later, open
Settings > Connection; Redline checks them with the server before saving.
Headers Redline sets itself, such as `X-Redmine-API-Key`, `Accept` and
`Content-Type`, can't be overridden.

If sign-in fails with a message about the server not letting the request
through, its HTTP status code is shown: that's usually the proxy asking for
something extra. Images linked from outside Redmine, and pages opened with
"Open in Redmine" in your browser, don't carry these headers.

## Platforms

macOS and Windows 10 and 11.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to build Redline and run it against a
local Redmine, and [docs/architecture.md](docs/architecture.md) for how it
fits together.

## License

[Apache-2.0](LICENSE)
