import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const missingEnvironmentVariables = [
  !supabaseUrl?.trim() && 'VITE_SUPABASE_URL',
  !supabasePublishableKey?.trim() && 'VITE_SUPABASE_PUBLISHABLE_KEY',
].filter(Boolean);

if (missingEnvironmentVariables.length > 0) {
  throw new Error(
    `Missing required Supabase browser configuration: ${missingEnvironmentVariables.join(', ')}`
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
