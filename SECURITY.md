# Security Policy

## Supported versions

Only the latest release on [npm](https://www.npmjs.com/package/token-larper) gets security fixes. Update with `bunx token-larper@latest`, or `git pull` if you run from a clone.

## Reporting a vulnerability

Please don't open a public issue for a security problem.

Use GitHub's private reporting instead: open the repository's [Security tab](https://github.com/YarooqH/token-larper/security) and choose **Report a vulnerability**, or go straight to [the report form](https://github.com/YarooqH/token-larper/security/advisories/new). Only the maintainers can see it.

A useful report says:

* What the problem is and what an attacker could do with it.
* The Token Larper version, your operating system, and how you run it (`bunx`, from source, or the Windows tray).
* Steps to reproduce it, or a proof of concept.

You can expect a first reply within a few days. If the report holds up, we'll work on a fix with you, publish it as a new release, and credit you in the advisory unless you'd rather stay anonymous.

## What's in scope

Token Larper runs locally and reads the session logs your coding agents write to disk. These are the kinds of problems we want to hear about:

* Another website or local program reading or changing your data through the dashboard's local server (for example, through a missing origin check or DNS rebinding).
* Your saved sign-ins, tokens, or prompts leaving your machine, or ending up in `server.log`, the data folder, or a request they shouldn't be in.
* The server listening on more than the local machine when it shouldn't.
* Path traversal or command injection through the local API, the CLI, or the Windows tray scripts.
* A tampered update or install path.

Problems in a dependency, such as [`ccusage`](https://github.com/ccusage/ccusage) or Bun, are best reported to that project. Tell us too if Token Larper's use of it makes the problem worse.
