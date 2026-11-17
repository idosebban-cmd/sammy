import { Redactor } from "../redact.ts";

function assertEquals(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

Deno.test("redacts configured names, longest first, and restores them", () => {
  const r = new Redactor([
    { term: "Blessing", replacement: "[Staff A]" },
    { term: "Ms Blessing", replacement: "[Teaching assistant]" },
    { term: "Oliver", replacement: "[Child 1]" },
  ], true);
  const red = r.redact("Ms Blessing said Oliver pushed him. Email ms.b@school.org.uk or call 020 7946 0123.");
  assertEquals(red, "[Teaching assistant] said [Child 1] pushed him. Email [email address removed] or call [phone number removed].");
  assertEquals(r.restoreDeep({ a: ["[Teaching assistant] helped", "[Child 1]"] }), { a: ["Ms Blessing helped", "Oliver"] });
});

Deno.test("does not redact inside other words", () => {
  const r = new Redactor([{ term: "Al", replacement: "[Child 2]" }], false);
  assertEquals(r.redact("Al and Alice"), "[Child 2] and Alice");
});
