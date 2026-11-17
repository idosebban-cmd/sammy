// Synthetic test data for evaluating Sammy's AI. Everything here is invented;
// it is shaped like the real situation described in the product brief so the
// AI's use of context can be judged. Dates are relative to the day it runs.

export function iso(daysFromToday) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

/** Next February half-term (approx.: third week of February). */
export function nextHalfTerm() {
  const now = new Date();
  const year = now.getUTCMonth() >= 2 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return { start: `${year}-02-15`, end: `${year}-02-19`, lastDayBefore: `${year}-02-12`, year };
}

export function fixtures() {
  const ht = nextHalfTerm();
  return {
    about: `Sammy is 6, in Year 2 at a mainstream primary school in London (class teacher: Mrs Okafor). He has an EHCP (finalised in May). Ms Blessing, a teaching assistant, began providing dedicated 1:1 support about five weeks ago. His placement and EHCP are due for review in February ${ht.year}.`,
    school_calendar: `Spring term starts ${ht.year}-01-05. February half-term: ${ht.start} to ${ht.end}. Spring term ends ${ht.year}-03-27.`,
    redactions: [{ term: "Ms Blessing", replacement: "[Teaching assistant A]" }, { term: "Oliver", replacement: "[Classmate A]" }],
    profile: [
      { section: "strengths", content: "Curious, loves space and trains, remembers facts in great detail.", evidence_type: "observation", source_label: "Our observation" },
      { section: "strengths", content: "Warm and sociable; includes younger children in games.", evidence_type: "observation", source_label: "Class teacher, parents' evening" },
      { section: "triggers", content: "Sammy has told us that collective worship is 'too loud and too long' and that he doesn't like not knowing when it will end.", evidence_type: "observation", source_label: "Sammy, in conversation at home" },
      { section: "triggers", content: "Transitions between activities and situations where he feels he has lost control are likely triggers for dysregulation.", evidence_type: "professional", source_label: "Educational Psychologist report, March" },
      { section: "early_signs", content: "Goes quiet, covers his ears, starts pacing or pulling at his sleeves.", evidence_type: "observation", source_label: "Our observation and TA" },
      { section: "helpful_strategies", content: "A visual 'now and next' card and advance warning before transitions.", evidence_type: "professional", source_label: "Educational Psychologist report, March" },
      { section: "helpful_strategies", content: "Being given a job (e.g. handing out books) during busy whole-class moments.", evidence_type: "observation", source_label: "Class teacher" },
      { section: "unhelpful_strategies", content: "Being told to 'calm down' or losing golden time as a consequence tends to escalate things.", evidence_type: "observation", source_label: "Our observation" },
    ],
    timeline: [
      { occurred_on: iso(-70), category: "anxiety", title: "Upset in Harvest assembly", description: "Covered his ears and asked to leave the hall; went back in after a short break.", progress_areas: ["anxiety_confidence"] },
      { occurred_on: iso(-50), category: "dysregulation", title: "Pushed a child during lining up", description: "After being moved to the back of the line unexpectedly. Took 25 minutes to settle.", progress_areas: ["emotional_regulation", "recovering"] },
      { occurred_on: iso(-35), category: "intervention", title: "Started: 1:1 support from Ms Blessing", description: "Dedicated TA support in the mornings and at lunch.", progress_areas: ["emotional_regulation"] },
      { occurred_on: iso(-20), category: "positive", title: "Told Ms Blessing he felt 'wobbly' before PE", description: "Named the feeling and asked for a minute in the book corner, then joined in.", progress_areas: ["emotional_regulation", "anxiety_confidence"] },
      { occurred_on: iso(-9), category: "positive", title: "Teacher reports a calmer fortnight", description: "Mrs Okafor emailed that he has been more settled in class and is accepting help from Ms Blessing more readily.", progress_areas: ["learning", "emotional_regulation"] },
      { occurred_on: iso(-2), category: "dysregulation", title: "Upset at home after a change of plan", description: "Swimming was cancelled at short notice; shouted and threw a cushion; calmed after 10 minutes with a hug.", progress_areas: ["recovering"] },
    ],
    interventions: [
      { name: "1:1 support from Ms Blessing (TA)", goal: "Help Sammy regulate and accept adult support during the school day", setting: "school", started_on: iso(-35), status: "active",
        observations: [
          { observed_on: iso(-20), apparent_effect: "seems_helpful", note: "Named his feelings to Ms Blessing before PE and accepted a short break.", assessment: "Encouraging early sign." },
          { observed_on: iso(-9), apparent_effect: "seems_helpful", note: "Teacher reports a calmer fortnight in class.", assessment: "Promising, but only a few weeks in." },
        ] },
      { name: "Visual 'now and next' card", goal: "Reduce anxiety at transitions", setting: "both", started_on: iso(-60), status: "active", observations: [] },
    ],
    actions: [
      { title: "Send OT report to SENCo before the review", owner: "helen", due_date: iso(10), priority: "medium", status: "todo", kind: "task" },
      { title: "Annual EHCP and placement review", owner: "both_parents", kind: "appointment", due_date: `${ht.year}-02-10`, due_time: "09:30", priority: "high", status: "todo" },
      { title: "School to confirm how 1:1 hours are split across the day", owner: "school", owner_detail: "SENCo", priority: "medium", status: "waiting", kind: "task" },
    ],
    documents: [
      {
        title: "EHCP – final", category: "ehcp", doc_date: `${ht.year - 1}-05-12`,
        pages: [
          "Education, Health and Care Plan. Section A: Sammy's views. Sammy says he likes trains, space and his friends. He says assembly is 'too loud'.",
          "Section B: Special educational needs. Sammy has significant difficulties with emotional regulation and anxiety, particularly at times of transition and in large, noisy group settings.",
          "Section F: Special educational provision. F1. Sammy will have access to a familiar adult throughout the school day to support emotional regulation, including during transitions and whole-school gatherings. F2. A visual timetable and 'now and next' card will be used consistently. F3. A quiet space will be available, which Sammy can access with an agreed exit card. F4. Small-group social communication sessions, 2 x 30 minutes weekly, delivered by a trained TA.",
          "Section I: Placement. Mainstream primary school. Review: the plan will be reviewed within 12 months.",
        ],
      },
      {
        title: "EHCP annual review – proposed amendments (draft)", category: "ehcp", doc_date: iso(-14),
        pages: [
          "Annual review – proposed amendments. This is a draft for discussion at the review meeting and has not been agreed.",
          "Proposed change to F1: Sammy will receive 1:1 support from a named teaching assistant for 20 hours per week, replacing 'access to a familiar adult'. Proposed new F5: an alternative activity will be offered during collective worship, to be reviewed after six weeks. F4 (small-group social communication sessions) – school reports these have taken place fortnightly rather than twice weekly due to staffing.",
        ],
      },
      {
        title: "Educational Psychologist report", category: "professional_report", doc_date: `${ht.year - 1}-03-20`,
        pages: [
          "Educational Psychologist report. Background and assessment. Sammy is a bright, articulate boy. Observation showed rising anxiety during transitions and when routines changed without warning; perceived loss of control appears to be a significant factor.",
          "Recommendations. R1. Give advance warning of transitions using a visual 'now and next' card. R2. Offer a quiet, low-stimulation alternative to large whole-school gatherings where these cause distress. R3. Teach emotional vocabulary using a feelings thermometer, practised daily. R4. Consider a referral to occupational therapy to assess sensory needs. R5. Staff to use co-regulation and avoid consequences that remove valued activities during dysregulation.",
        ],
      },
      {
        title: "School meeting notes – October", category: "meeting_notes", doc_date: iso(-40),
        pages: [
          "Meeting between parents, class teacher (Mrs Okafor) and SENCo. Agreed actions: School will start 1:1 support with Ms Blessing from next week. School will introduce a feelings thermometer in class. SENCo will look into the OT referral and update parents by half-term. School will share a weekly note on how Sammy's mornings have gone.",
        ],
      },
    ],
    commitments: [
      { kind: "professional_recommendation", certainty: "confirmed", description: "Offer a quiet, low-stimulation alternative to large whole-school gatherings where these cause distress.", made_by: "Educational Psychologist", doc: "Educational Psychologist report", page: 2 },
      { kind: "professional_recommendation", certainty: "confirmed", description: "Consider a referral to occupational therapy to assess sensory needs.", made_by: "Educational Psychologist", doc: "Educational Psychologist report", page: 2 },
      { kind: "ehcp_provision", certainty: "confirmed", description: "Access to a familiar adult throughout the school day, including transitions and whole-school gatherings.", made_by: "Local Authority", ehcp_section: "F1", doc: "EHCP – final", page: 3 },
      { kind: "professional_commitment", certainty: "reported", description: "SENCo will look into the OT referral and update parents by half-term.", made_by: "SENCo", doc: "School meeting notes – October", page: 1 },
    ],
  };
}

export const WORSHIP_EMAIL = `Dear Ido and Helen,

I'm sorry to let you know that Sammy had a difficult start this morning. During collective worship he became very upset when the hall was filling up and he was asked to move to a different row. He shouted and pushed Oliver, who was sitting next to him. Ms Blessing took him out to the quiet room and he settled after about 15 minutes. He then had a good rest of the morning and did some lovely writing about trains.

We'd like to talk about how we support him during whole-school gatherings. Could you let us know by Friday whether you can come in for a short meeting next week? We will also look at the alternative activity idea from the review paperwork before half-term.

Best wishes,
Mrs Okafor`;

export const POSITIVE_OBSERVATION = `Ms Blessing told me at pick-up that Sammy went into assembly today with his exit card, used it once to step out for a couple of minutes, and came back in by himself. He was proud of it.`;

export const CONTRADICTORY_EMAIL = `Hi both,

Just a quick note to say Sammy has had a great week — no incidents at all, and he has been brilliant in assemblies. The new 1:1 support is clearly working and I don't think we need the alternative worship arrangement any more.

Thanks,
Mrs Okafor`;

export const RELATIVE_DATES_EMAIL = `Dear Ido and Helen,

Following our chat, a few things: I'll send you the updated one-page profile next Friday. The SENCo will confirm the OT referral before half-term. Please could you return the parent views form within two weeks. The review meeting is on 10 February at 9:30.

Kind regards,
Mrs Okafor`;

export const CHAT_QUESTIONS = [
  { id: "ehcp_adult_support", q: "What does Sammy's EHCP require regarding adult support?" },
  { id: "ep_not_followed", q: "Which Educational Psychologist recommendations haven't been followed up?" },
  { id: "october_commitments", q: "What did the school commit to at the October meeting?" },
  { id: "ehcp_compare", q: "What has changed between the May EHCP and the November review paperwork?" },
  { id: "missing_doc", q: "What did the speech and language therapist recommend?" },
  { id: "advice", q: "Mornings before school are getting harder. What could we try?" },
];
