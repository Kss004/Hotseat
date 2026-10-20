import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { personaSchema } from "@/types";
import { POST as personaPOST, PATCH as personaPATCH } from "@/app/api/sessions/[id]/persona/route";
import { GET as sessionGET } from "@/app/api/sessions/[id]/route";
import fixturePersona from "../fixtures/llm/persona.json";
import { createSession, jsonRequest, params, resetDb, useLiveMode, useReplayMode } from "./helpers";

describe("Step 2: Persona generation & editable persona card", () => {
  beforeAll(() => useReplayMode());
  afterAll(() => useLiveMode());
  beforeEach(() => resetDb());

  it("1. Persona schema rejects missing fields and out-of-enum values", () => {
    expect(personaSchema.safeParse(fixturePersona).success).toBe(true);
    expect(personaSchema.safeParse({ ...fixturePersona, risk_posture: "reckless" }).success).toBe(false);
    expect(personaSchema.safeParse({ ...fixturePersona, business_priorities: [] }).success).toBe(false);
  });

  it("2. POST generates and stores the persona, returning the stored id", async () => {
    const sessionId = await createSession();
    const res = await personaPOST(jsonRequest({}), params(sessionId));
    expect(res.status).toBe(200);
    const { persona } = await res.json();
    expect(persona.risk_posture).toBe("risk_averse");

    // Regenerating keeps one row per session and reports that row's id
    const again = await (await personaPOST(jsonRequest({}), params(sessionId))).json();
    expect(again.persona.id).toBe(persona.id);
  });

  it("3. PATCH edits persist through a reload with edited_by_user = 1", async () => {
    const sessionId = await createSession();
    await personaPOST(jsonRequest({}), params(sessionId));

    const edited = { ...fixturePersona, hot_buttons: ["Hand-wavy security answers"], technical_depth: "moderate" };
    const res = await personaPATCH(jsonRequest(edited, "PATCH"), params(sessionId));
    expect(res.status).toBe(200);

    const reloaded = await (await sessionGET(jsonRequest({}, "GET"), params(sessionId))).json();
    expect(reloaded.persona.hot_buttons).toEqual(["Hand-wavy security answers"]);
    expect(reloaded.persona.technical_depth).toBe("moderate");
    expect(Number(reloaded.persona.edited_by_user)).toBe(1);
  });

  it("4. PATCH rejects invalid edits with VALIDATION and leaves the stored persona unchanged", async () => {
    const sessionId = await createSession();
    await personaPOST(jsonRequest({}), params(sessionId));

    const res = await personaPATCH(jsonRequest({ ...fixturePersona, name: "" }, "PATCH"), params(sessionId));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION");

    const reloaded = await (await sessionGET(jsonRequest({}, "GET"), params(sessionId))).json();
    expect(reloaded.persona.name).toBe(fixturePersona.name);
  });
});
