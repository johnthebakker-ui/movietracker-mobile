import "react-native-url-polyfill/auto";
import { createClient, processLock } from "@supabase/supabase-js";
import { HAS_SUPABASE, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { secureAuthStorage } from "./secure-storage";

export const supabase = HAS_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: secureAuthStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        lock: processLock,
        flowType: "pkce"
      }
    })
  : null;
