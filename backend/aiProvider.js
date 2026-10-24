// Provider selection is explicit when AI_PROVIDER is set; failures never switch providers.
function aiConfig() {
  const provider = (process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY?.trim() ? 'gemini' : 'openai')).trim().toLowerCase();
  if (provider === 'gemini') return { provider, providerName: 'Google Gemini', apiKey: process.env.GEMINI_API_KEY?.trim() || '', planningModel: 'gemini-3.5-flash-lite', matchingModel: 'gemini-embedding-2', dataNotice: 'Google free-tier content may be used to improve its products. Do not include confidential or personal information.' };
  if (provider === 'openai') return { provider, providerName: 'OpenAI', apiKey: process.env.OPENAI_API_KEY?.trim() || '', planningModel: process.env.OPENAI_PLAN_MODEL || 'gpt-4o-mini', matchingModel: 'text-embedding-3-small', dataNotice: '' };
  return { provider: 'unconfigured', providerName: 'AI provider', apiKey: '', dataNotice: '' };
}
function aiStatus() {
  const { apiKey, ...status } = aiConfig();
  return { ...status, available: Boolean(apiKey) };
}
module.exports = { aiConfig, aiStatus };

async function requireAiResponse(response, feature) {
  if (response.ok) return;
  let code = 'UNKNOWN';
  try { const data = await response.json(); const candidate = data?.error?.status; if (['INVALID_ARGUMENT','PERMISSION_DENIED','NOT_FOUND','RESOURCE_EXHAUSTED','UNAUTHENTICATED','FAILED_PRECONDITION','UNAVAILABLE'].includes(candidate)) code=candidate; } catch {}
  // Never log request headers, keys, provider response text or user content.
  console.error('AI provider request failed', JSON.stringify({ provider: aiConfig().provider, feature, status: response.status, code }));
  const message = response.status === 429 ? 'AI free quota is currently exhausted. Try later or use the guided draft.' : response.status === 401 || response.status === 403 ? 'AI access is not ready. Check the server API key and project access.' : 'AI service is unavailable right now. Use the guided draft meanwhile.';
  const error = new Error(message); error.aiProviderFailure=true; error.status=response.status===429?429:502; throw error;
}
module.exports.requireAiResponse = requireAiResponse;
