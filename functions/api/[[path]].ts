import worker from '../../worker/index';
import type { Env } from '../../worker/index';

type PagesContext = {
  request: Request;
  env: Env;
};

/**
 * Keep the Pages frontend and API on one origin. The shared handler verifies
 * Cloudflare Access JWTs and fails closed when the owner policy is not set.
 */
export async function onRequest({ request, env }: PagesContext): Promise<Response> {
  return worker.fetch(request, env);
}
