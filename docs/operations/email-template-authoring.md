# Email Template Authoring

Templates live under `email-templates`. Stage 3.13B uses one `template.json` per locale/template plus shared locale footers.

## Structure

```text
email-templates/
  shared/
    ru/footer.json
    en/footer.json
  ru/<template-key>/template.json
  en/<template-key>/template.json
```

Each template contains:

- `metadata`: key, version, locale, message type, category, variables, sender, reply-to, footer, sensitivity, future stage, and runtime flag.
- `subject`: plain subject template.
- `text`: plain text body.
- `html`: restricted HTML body.

## Variables

Use only `{{variableName}}` placeholders declared in `metadata.variables`.

Allowed variable types:

- `string`
- `url`

Unknown variables, missing required variables, unsafe URLs, and unresolved placeholders fail validation/rendering.

## Security Rules

- No JavaScript, expressions, helpers, includes, dynamic paths, tracking pixels, scripts, or remote images.
- HTML variables are escaped by default.
- URL variables must be absolute `http` or `https` URLs without embedded credentials.
- Subjects must not contain CR/LF.
- Do not place passwords, reset tokens, permanent bearer invitation tokens, transcript text, raw AI output, storage keys, or credentials in templates.
- Invitation templates must use future safe action URLs, not permanent `joinToken`, `hostToken`, or `participantToken` values.

## Runtime Enablement

Only `system-test` is runtime-enabled in Stage 3.13B. Password, invitation, and admin notification templates are reserved for future stages and must keep `runtimeEnabled=false` until their business flows are implemented and tested.

## Validation

```shell
npm run email:templates:validate
```

Initial operational wording requires legal/product review before broad production use.
