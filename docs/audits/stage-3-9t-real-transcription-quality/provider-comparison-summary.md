# Provider Comparison Summary

Canonical audio used for cross-provider comparison:

- `active-audio.wav`
- SHA-256: `257bb6885405b616e0c06c29943381f78c058e9017070f8343bc07a24a09af19`

## Main Findings

- Yandex baseline reproduces the known pathology: `"там просто 40 такой"`.
- OpenAI (`ru` and `auto`) retained `"сорт такой"` and did not emit `"40"` in audited output.
- OpenAI outputs were more readable (punctuation/capitalization) in sampled excerpts.
- This does not prove OpenAI recovers omitted speech globally; reference duration is below target.

## Completeness vs Readability

- Completeness (word count) was slightly lower for OpenAI in this sample.
- Readability was better for OpenAI.
- Yandex produced more words but included a key lexical substitution.

## Hallucination Check

- No clear hallucination signal was observed in short sampled excerpts.
- Full hallucination risk ranking remains open pending larger human-reviewed reference.
