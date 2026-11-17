#!/usr/bin/env node
// One-off setup: creates the private workspace and the two parent accounts.
// Public sign-up is disabled, so this (run by you, with the service-role key,
// from your own machine) is the only way accounts are created.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/bootstrap.mjs --parent "Ido:ido@example.com" --parent "Helen:helen@example.com"
//
// Each parent gets a random temporary password, printed once. Change it in
// Settings after first sign-in. Never commit or share the service-role key.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const parents = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--parent") {
    const [name, email] = (args[++i] ?? "").split(":");
    if (!name || !email) throw new Error(`--parent expects "Name:email", got "${args[i]}"`);
    parents.push({ name: name.trim(), email: email.trim().toLowerCase() });
  }
}
if (!parents.length) {
  console.error('Pass at least one --parent "Name:email".');
  process.exit(1);
}
const childName = process.env.CHILD_NAME ?? "Sammy";

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
}

let { data: ws } = await admin.from("workspaces").select("id").limit(1).maybeSingle();
if (!ws) {
  const res = await admin.from("workspaces").insert({ name: `${childName}'s family`, child_name: childName }).select("id").single();
  if (res.error) throw res.error;
  ws = res.data;
  console.log(`Created workspace ${ws.id}`);
} else {
  console.log(`Using existing workspace ${ws.id}`);
}
const s = await admin.from("ai_settings").upsert({ workspace_id: ws.id }, { onConflict: "workspace_id", ignoreDuplicates: true });
if (s.error) throw s.error;

for (const p of parents) {
  let user = await findUser(p.email);
  if (user) {
    console.log(`${p.name}: account already exists (${p.email})`);
  } else {
    const password = randomBytes(12).toString("base64url");
    const { data, error } = await admin.auth.admin.createUser({ email: p.email, password, email_confirm: true });
    if (error) throw error;
    user = data.user;
    console.log(`${p.name}: created ${p.email} with temporary password  ${password}`);
  }
  const m = await admin.from("workspace_members").upsert({ workspace_id: ws.id, user_id: user.id, display_name: p.name });
  if (m.error) throw m.error;
}
console.log("Done. Sign in, then change each password in Settings.");
