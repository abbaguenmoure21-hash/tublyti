import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// Read env variables (this runs locally on user's machine so we can just grab them if possible, 
// or since we are in the next.js app root, we can load from .env.local)
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error, count } = await supabase
    .from('candidate_channels')
    .select('*', { count: 'exact' });
    
  console.log('Total count:', count);
  
  if (data && data.length > 0) {
    const statuses = new Set(data.map(d => d.status));
    console.log('Available statuses:', Array.from(statuses));
    console.log('Sample row:', data[0]);
  }
}

main().catch(console.error);
