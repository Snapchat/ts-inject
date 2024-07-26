# Contributing guide

Thanks for taking the time to contribute! We appreciate contributions whether it's:

- Reporting a bug
- Submitting a fix or new feature
- Proposing new features

## Report bugs using Github [issues](../../issues)

We use GitHub [issues](../../issues) to track public bugs. Report a bug by opening a new issue; it's easy!

When reporting bugs, please include enough details so that it can be investigated. Bug reports should have:

- A summary or background
- Steps to reproduce
- Give code sample if you can
- What is the expected result
- What actually happens

## Contributing fixes and features

Pull requests are the best way to propose code changes:

1. Fork the repo and create your branch from `main`.
2. Run `nvm use && npm ci` and check in any changes to generated code.
3. Add tests, if appropriate.
4. Run `npm test` to ensure the test suite passes with your change.
5. Run `npm run styleguide:fix` to ensure coding guidelines are followed.
6. Issue the pull request.

## License

Any contributions you make will be under the same MIT license that covers the project.
