import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ObjectPictogram } from "@/components/object-pictogram";

test("decorative object pictogram is hidden from screen readers", () => {
  const markup = renderToStaticMarkup(
    createElement(ObjectPictogram, { objectType: "event", size: 32 }),
  );

  assert.match(markup, /aria-hidden="true"/);
  assert.match(markup, /alt=""/);
});

test("object pictogram renders light and dark theme variants", () => {
  const markup = renderToStaticMarkup(
    createElement(ObjectPictogram, { objectType: "room", size: 32 }),
  );

  assert.match(markup, /light%2Froom-32\.png/);
  assert.match(markup, /dark%2Froom-32\.png/);
  assert.match(markup, /dark:hidden/);
  assert.match(markup, /dark:block/);
});

test("informative object pictogram accepts explicit alt text", () => {
  const markup = renderToStaticMarkup(
    createElement(ObjectPictogram, {
      objectType: "case",
      size: 32,
      decorative: false,
      alt: "Case pictogram",
    }),
  );

  assert.doesNotMatch(markup, /aria-hidden="true"/);
  assert.match(markup, /alt="Case pictogram"/);
});
