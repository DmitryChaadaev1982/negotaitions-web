# Common-password blocklist

Server-side whole-password denylist used by `lib/auth/common-password-blocklist.ts`.
It is not imported by client components.

## `common-passwords.txt`

Password strings only, one entry per line. No usernames, email addresses, or
account pairs.

Source:

- Project: [SecLists](https://github.com/danielmiessler/SecLists)
- File: `Passwords/Common-Credentials/10k-most-common.txt`
- Retrieved: 2026-09-23 from the master branch rendering of that file
- Entries kept: 10000
- Lines containing `@`, `:`, or whitespace were not imported

License: MIT. The copyright notice and permission notice below are included
because this file is a substantial portion of that project.

```
MIT License

Copyright (c) 2018 Daniel Miessler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## `common-passwords-curated.txt`

Repository-owned additions. These strings were written for this product. They
are not copied from a breach corpus. They add obvious whole-password product
terms, a few common English and Russian passwords used by the policy tests,
and one test sentinel (`qx7-stage2b-common-sentinel`).

Comparison for every entry, including the SecLists file, is whole-password
only after NFKC, lowercase, and outer trim. That normalization is not applied
to the stored credential.
