# Maintainers Guide

This document describes tools, tasks and workflow that one needs to be familiar with in order to effectively maintain
this project. If you use this package within your own software as is but don't plan on modifying it, this guide is
**not** for you.

## Tools

Prerequisites: You must install the correct version of node (`>= v8`) and npm (`>= v5`). If you use nvm, you can run
`nvm use` in the project directory to switch node versions.

Install dependencies: `npm install`

## Tasks

### Building

The application can be built in the following configurations:

Development: `npm run build`. After a successful build, the application can be run using `node bin/cli.js <command>`.

Release: `npm run dist`. After a successful build, the individual platform binaries will be inside the `/pkg` directory.

### Testing

**TODO**

### Generating Documentation

Documentation is built using GitHub Pages and he integrated Jekyll build system. Edits that are made in the `/docs`
directly will automatically be built and published to the website once the changes are merged to the `master` branch.

### Releasing

1.  Create the commit for the release:
    *  Bump the version number in adherence to [Semantic Versioning](http://semver.org/) in `package.json`.
    *  Commit with a message including the new version number. For example `v1.0.8`.
    *  Tag the commit with the version number. For example `v1.0.8`.

2.  Distribute the release
    *  Build the application for release
    *  Package the application
      -  Assemble a directory with the following structure:
          .
          ├── LICENSE         a copy of `/LICENSE` in the project directory
          ├── Windows
          │   └── steno.exe   a copy of `/pkg/steno-win.exe`
          ├── linux
          │   └── steno       a copy of `/pkg/steno-linux`
          └── macOS
              └── steno       a copy of `/pkg/steno-macos`
      -  Compress the directory into a zip file
    *  Create a GitHub Release. This will also serve as a Changelog for the project. Add a
       description of changes to the Changelog. Mention Issue and PR #'s and @-mention
       contributors. Upload the zip file as an asset for this release.
    *  Trigger a build of the GitHub Pages documentation

3.  Announce the release in the appropriate channels.

## Workflow

### Versioning and Tags

This project is versioned using [Semantic Versioning](http://semver.org/), particularly in the
[npm flavor](https://docs.npmjs.com/getting-started/semantic-versioning). Each release is tagged
using git.

### Branches

`master` is where active development occurs. Long running named feature branches are occasionally
created for collaboration on a feature that has a large scope (because everyone cannot push commits
to another person's open Pull Request). At some point in the future after a major version increment,
there may be maintenance branches for older major versions.

### Issue Management

Labels are used to run issues through an organized workflow. Here are the basic definitions:

*  `bug`: A confirmed bug report. A bug is considered confirmed when reproduction steps have been
   documented and the issue has been reproduced.
*  `enhancement`: A feature request for something this package might not already do.
*  `docs`: An issue that is purely about documentation work.
*  `tests`: An issue that is purely about testing work.
*  `needs feedback`: An issue that may have claimed to be a bug but was not reproducible, or was otherwise missing some information.
*  `discussion`: An issue that is purely meant to hold a discussion. Typically the maintainers are looking for feedback in this issues.
*  `question`: An issue that is like a support request because the user's usage was not correct.
*  `semver:major|minor|patch`: Metadata about how resolving this issue would affect the version number.
*  `security`: An issue that has special consideration for security reasons.
*  `good first contribution`: An issue that has a well-defined relatively-small scope, with clear expectations. It helps when the testing approach is also known.
*  `duplicate`: An issue that is functionally the same as another issue. Apply this only if you've linked the other issue by number.

**Triage** is the process of taking new issues that aren't yet "seen" and marking them with a basic
level of information with labels. An issue should have **one** of the following labels applied:
`bug`, `enhancement`, `question`, `needs feedback`, `docs`, `tests`, or `discussion`.

Issues are closed when a resolution has been reached. If for any reason a closed issue seems
relevant once again, reopening is great and better than creating a duplicate issue.

## Everything else

When in doubt, find the other maintainers and ask.
