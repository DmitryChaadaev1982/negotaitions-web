# Official API Capability Notes

## Target capability

Probe target was provider-enforced JSON Schema in both endpoints:

- Responses API structured output under `text.format` with `type=json_schema`.
- Chat Completions structured output under `response_format` with `type=json_schema`.

## References

- [Yandex AI Studio structured output concept](https://aistudio.yandex.ru/docs/ai-studio/concepts/generation/structured-output)
- [Yandex AI Studio Responses API](https://aistudio.yandex.ru/docs/ai-studio/responses/)
- [Yandex AI Studio OpenAI-compatible API](https://aistudio.yandex.ru/docs/ai-studio/concepts/api#openai)
- [Yandex AI Studio SDK](https://github.com/yandex-cloud/yandex-ai-studio-sdk)
- [Yandex Cloud FoundationModelsCall integration (jsonSchema/jsonObject behavior)](https://yandex.cloud/en/docs/serverless-integrations/concepts/workflows/yawl/integration/foundationmodelscall)

## Request-shape assumptions validated in probe

Validated live against provider:

1. Responses API accepted request body with:
   - `model`, `instructions`, `input`, `temperature`, `max_output_tokens`
   - `text.format = { type: "json_schema", name, strict, schema }`

2. Chat Completions API accepted request body with:
   - `model`, `messages`, `temperature`, `max_tokens`
   - `response_format = { type: "json_schema", json_schema: { name, strict, schema } }`

3. For tested model `deepseek-v4-flash`, both schemas were accepted, with structurally valid outputs.

## Limitations

- Automated retrieval of some `aistudio.yandex.ru` pages may be blocked by anti-bot checks.
- Capability confirmation in this probe is therefore based on:
  - official Yandex documentation URLs listed above, and
  - empirical provider acceptance and output conformance measurements.
