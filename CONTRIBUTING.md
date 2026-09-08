# Contributing to ServeTracker

Bug reports, security reports, documentation improvements, tests, and pull requests are welcome. ServeTracker is source-available software governed by the [ServeTracker Source-Available Internal Business Use License](LICENSE); it is not an OSI-approved open-source project.

## Before submitting

- Search existing issues and pull requests to avoid duplicate work.
- Keep a pull request focused on one change.
- Do not include credentials, API keys, access tokens, passwords, private keys, personal information, client or case data, court documents, service-attempt data, photographs, database files, production URLs that are not already public, or other confidential material.
- Add or update tests when behavior changes.
- Run `bun test` and `bun run build` when the development environment supports them.
- Preserve all license, copyright, attribution, and provenance notices.
- Identify every piece of third-party material in the Contribution and disclose its source, copyright owner, applicable license, and required notices. Do not submit third-party material unless its terms permit the grants in this document.

## Contributor License Grant

By intentionally submitting a pull request, patch, commit, issue attachment, or other Contribution to the official ServeTracker repository at https://github.com/SillyHippy/ServeTracker and affirming the required certification, you agree to this Contributor License Grant. You represent that you have the legal right to submit the Contribution and that it does not knowingly violate another person’s intellectual-property, privacy, confidentiality, or contractual rights. If you submit on behalf of an employer or another organization, you represent that you are authorized to bind that entity, and “you” includes that entity.

You retain ownership of your original Contribution. You grant each of Joseph Iannazzi and Just Legal Solutions LLC, and each recipient’s successors and assigns, independently, a perpetual, irrevocable, worldwide, royalty-free, fully paid, transferable, and sublicensable copyright license to use, reproduce, modify, prepare derivative works from, publicly display, publicly perform, distribute, host, sell, offer for sale, import, and relicense the Contribution under any terms, including source-available, proprietary, or commercial terms.

You also grant those recipients and their successors and assigns a perpetual, irrevocable, worldwide, royalty-free, fully paid, transferable, and sublicensable patent license under patent claims you own or control that are necessarily infringed by the Contribution alone or by its combination with ServeTracker as submitted, to make, have made, use, offer for sale, sell, import, and otherwise transfer the Contribution and such combination.

To the fullest extent permitted by law, you waive and agree not to assert moral rights, droit moral, and similar rights in the Contribution. Where waiver is not permitted, you consent to all acts authorized by these grants. These nonexclusive grants do not purport to transfer infringement-enforcement standing that applicable law requires an owner or exclusive licensee to possess.

These grants allow ServeTracker to accept, maintain, commercialize, and relicense community work without requiring future permission. They do not give a contributor permission to sell or redistribute ServeTracker; the repository’s LICENSE continues to govern use of the Software.

## Required pull-request certification

Every pull request must include the following checked certification:

> I have read and agree to the Contributor License Grant in CONTRIBUTING.md; I have authority to grant those rights for myself and any entity on whose behalf I submit; and I have identified all third-party material and disclosed all applicable license terms.

A Contribution may be rejected until this certification is provided. Submission does not guarantee acceptance, compensation, attribution beyond repository history, support, or inclusion in any release.

## Security issues

Do not publish an exploitable vulnerability or exposed credential in a public issue. Contact `joseph@justlegalsolutions.org` with enough detail to reproduce and assess the issue. Do not access, alter, download, or retain data belonging to another person while researching a vulnerability.

## Development flow

1. Fork the repository for the limited purpose allowed by the LICENSE.
2. Create a focused branch.
3. Make the change without including production data or secrets.
4. Run relevant tests and the production build.
5. Open a pull request explaining what changed, why, and how it was tested.
6. Check the required contributor certification in the pull-request template.
