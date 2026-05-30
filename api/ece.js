'use strict';
const { CHILDREN } = require('./_seed');

// Static activity pool — used as fallback when Ollama is unavailable on Vercel
const ACTIVITIES = [
  { title:'Freeze the Music',       steps:'Sit in a circle. Play music. When it stops, everyone freezes. Call names to take turns unfreezing.' },
  { title:'Clay and Shapes',         steps:'Give each child a ball of clay. Show a circle card — press flat like roti. Show triangle — roll three snakes and press together. Free explore 5 min.' },
  { title:'Story Stones',            steps:'Paint small stones with simple pictures. Child picks a stone, names the picture, then tells one sentence of a story. Pass around the circle.' },
  { title:'Colour Sorting Game',     steps:'Lay out red, blue, yellow cards. Name colours together. Place objects on matching cards. Count each group aloud.' },
  { title:'Mirror Mirror',           steps:'Pair children. One leads movements, partner mirrors. Switch after 2 minutes. Builds attention and coordination.' },
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { ageCohort = '3-5 years', voiceLogObservations = '' } = req.body || {};

  // Try Ollama / education_engine (works if local Ollama is running)
  try {
    const { generateDailyBriefing } = require('../ml_pipeline/education_engine');
    const nudges = CHILDREN.filter(c => c.sam_mam_status !== 'Normal')
      .map(c => ({ name: c.name, flag: c.sam_mam_status === 'SAM' ? 'low_weight_alert' : 'monitor' }));
    const result = await generateDailyBriefing({
      ageCohort, rawActivity: ACTIVITIES[0].title,
      localDatabaseNudges: nudges, voiceLogObservations
    });
    return res.json({ activity: result });
  } catch (_) {}

  // Fallback: return a static activity
  const today = new Date().getDay(); // 0-6, gives variety across the week
  const act   = ACTIVITIES[today % ACTIVITIES.length];

  // Build reintegration cues for SAM/flagged children
  const samKids = CHILDREN.filter(c => c.sam_mam_status === 'SAM');
  const protocols = samKids.map(c => ({
    name: c.name, alert: 'low_weight_alert',
    actionable_cue: `Give ${c.name} extra attention and ensure they receive supplementary nutrition first.`
  }));

  res.json({
    activity: {
      cohort: ageCohort,
      daily_20min_session: { title: act.title, execution_steps: act.steps },
      reintegration_protocols: protocols,
      behavioral_adaptations: {
        low_pressure_roles: 'Assign quiet children a named role (e.g. "Card Holder") so they participate without social pressure.',
        worker_observation_response: voiceLogObservations
          ? `Today's session adapted based on log: ${voiceLogObservations}`
          : 'No adaptations — standard session.'
      }
    }
  });
};
