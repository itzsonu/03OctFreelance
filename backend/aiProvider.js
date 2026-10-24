// Provider selection is explicit when AI_PROVIDER is set; failures never switch providers.
function aiConfig() {
  const provider = (process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY?.trim() ? 'gemini' : 'openai')).trim().toLowerCase();
  if (provider === 'gemini') return { provider, providerName: 'Google Gemini', apiKey: process.env.GEMINI_API_KEY?.trim() || '', planningModel: 'gemini-2.5-flash-lite', matchingModel: 'gemini-embedding-2', dataNotice: 'Google free-tier content may be used to improve its products. Do not include confidential or personal information.' };
  if (provider === 'openai') return { provider, providerName: 'OpenAI', apiKey: process.env.OPENAI_API_KEY?.trim() || '', planningModel: process.env.OPENAI_PLAN_MODEL || 'gpt-4o-mini', matchingModel: 'text-embedding-3-small', dataNotice: '' };
  return { provider: 'unconfigured', providerName: 'AI provider', apiKey: '', dataNotice: '' };
}
function aiStatus() {
  const { apiKey, ...status } = aiConfig();
  return { ...status, available: Boolean(apiKey) };
}
module.exports = { aiConfig, aiStatus };
