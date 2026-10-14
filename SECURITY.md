# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub's [private vulnerability reporting](https://github.com/ArkanisCorporation/dcsh/security/advisories/new):
on the repository, go to **Security → Report a vulnerability**. This opens a confidential
advisory visible only to you and the maintainers.

Please include:

- affected version (`dcsh --version` or the installed npm version),
- a description of the issue and its impact,
- steps to reproduce, if possible.

We aim to acknowledge a report within a few days and will keep you updated as we work on a fix.
Once a fix is released we will publish an advisory and credit the reporter, unless you prefer to
stay anonymous.

## Scope

`dcsh` acts as a Discord bot over the REST API using a token **you** supply. The most important
security property is that it never transmits your token anywhere except Discord, and never writes
it to the history file or logs. Reports that concern token handling, the audit-reason guard, or the
read-only guard are especially welcome.

Note that `dcsh` is a tool for privileged bot operations: anyone holding a bot token can already
perform any action that token permits. The guards protect against _mistakes_, not against a
malicious operator who already has the token.

## Supported versions

Only the latest released version is supported. Please upgrade before reporting.
