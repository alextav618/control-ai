// Minimal Database type definition - adjust based on your actual schema
export interface Database {
  public: {
    Tables: {
      [key: string]: {
        Row: Record<string, any>;
        Insert: Record<string, any>;
        Update: Record<string, any>;
      };
    };
    Enums: {
      [key: string]: string[];
    };
  };
}

// Simplified Enums type that doesn't depend on missing types
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];