const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;
const SLACK_WEBHOOK = process.env.SLACK_CONTACT_WEBHOOK;

// In-memory rate limiting store
const rateLimitStore = new Map();

const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5; // max requests per window

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(ip, { windowStart: now, count: 1 });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) return true;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(TURNSTILE_SECRET)}&response=${encodeURIComponent(token)}&remoteip=${encodeURIComponent(ip || '')}`,
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

function calculateLeadScore({ company_size, use_case, deployment_timeline, email, budget }) {
  let lead_score = 0;

  // Company size scoring
  const sizeScores = {
    '1-10': 5,
    '11-50': 10,
    '51-200': 20,
    '201-1000': 30,
    '1000+': 40,
  };
  lead_score += sizeScores[company_size] || 5;

  // Use case scoring
  const useCaseScores = {
    'enterprise_deployment': 25,
    'team_integration': 20,
    'api_access': 20,
    'custom_solution': 15,
    'evaluation': 10,
    'personal': 5,
  };
  lead_score += useCaseScores[use_case] || 5;

  // Deployment timeline scoring
  const timelineScores = {
    'immediate': 25,
    '1_month': 20,
    '1_3_months': 15,
    '3_6_months': 10,
    'exploratory': 5,
  };
  lead_score += timelineScores[deployment_timeline] || 5;

  // Budget scoring
  const budgetScores = {
    'enterprise': 20,
    'team': 15,
    'starter': 10,
    'undecided': 5,
  };
  lead_score += budgetScores[budget] || 0;

  // Corporate email bonus
  if (email && !email.match(/@(gmail|yahoo|hotmail|outlook|aol)\./i)) {
    lead_score += 10;
  }

  return Math.min(lead_score, 100);
}

function isQualifiedLead(lead_score, { company_size, deployment_timeline }) {
  if (lead_score >= 50) return true;
  if (company_size === '1000+' && deployment_timeline === 'immediate') return true;
  return false;
}

async function notifySlack({ name, email, company, company_size, use_case, deployment_timeline, message, lead_score, qualified_lead }) {
  if (!SLACK_WEBHOOK) return;
  try {
    const qualifiedEmoji = qualified_lead ? '🔥' : '📋';
    const text = `${qualifiedEmoji} *New Contact Form Submission*\n` +
      `*Name:* ${name}\n*Email:* ${email}\n*Company:* ${company || 'N/A'}\n` +
      `*Company Size:* ${company_size || 'N/A'}\n*Use Case:* ${use_case || 'N/A'}\n` +
      `*Deployment Timeline:* ${deployment_timeline || 'N/A'}\n` +
      `*Lead Score:* ${lead_score}/100\n*Qualified Lead:* ${qualified_lead ? 'YES' : 'No'}\n` +
      `*Message:* ${message || 'N/A'}`;
    await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch { /* best-effort */ }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { name, email, company, company_size, use_case, deployment_timeline, budget, message, turnstile_token } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const turnstileValid = await verifyTurnstile(turnstile_token, ip);
  if (!turnstileValid) {
    return res.status(403).json({ error: 'Bot verification failed. Please try again.' });
  }

  const lead_score = calculateLeadScore({ company_size, use_case, deployment_timeline, email, budget });
  const qualified_lead = isQualifiedLead(lead_score, { company_size, deployment_timeline });

  const submission = {
    name,
    email,
    company: company || null,
    company_size: company_size || null,
    use_case: use_case || null,
    deployment_timeline: deployment_timeline || null,
    budget: budget || null,
    message: message || null,
    lead_score,
    qualified_lead,
    submitted_at: new Date().toISOString(),
    ip_hash: Buffer.from(ip).toString('base64'),
  };

  await notifySlack(submission);

  return res.status(200).json({
    success: true,
    message: qualified_lead
      ? 'Thank you! A member of our enterprise team will reach out within 24 hours.'
      : 'Thank you for your interest! We will be in touch soon.',
    lead_score,
    qualified_lead,
  });
}
