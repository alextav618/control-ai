export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          archived: boolean
          closing_day: number | null
          color: string | null
          created_at: string
          credit_limit: number | null
          current_balance: number
          due_day: number | null
          icon: string | null
          id: string
          name: string
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          closing_day?: number | null
          color?: string | null
          created_at?: string
          credit_limit?: number | null
          current_balance?: number
          due_day?: number | null
          icon?: string | null
          id?: string
          name: string
          type: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          closing_day?: number | null
          color?: string | null
          created_at?: string
          credit_limit?: number | null
          current_balance?: number
          due_day?: number | null
          icon?: string | null
          id?: string
          name?: string
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          data: Json | null
          id: string
          level: Database["public"]["Enums"]["audit_level"] | null
          reasoning: string | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          data?: Json | null
          id?: string
          level?: Database["public"]["Enums"]["audit_level"] | null
          reasoning?: string | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          data?: Json | null
          id?: string
          level?: Database["public"]["Enums"]["audit_level"] | null
          reasoning?: string | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          kind: Database["public"]["Enums"]["transaction_type"]
          name: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["transaction_type"]
          name: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["transaction_type"]
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          attachment_type: string | null
          attachment_url: string | null
          content: string
          created_at: string
          id: string
          metadata: Json | null
          related_transaction_id: string | null
          role: Database["public"]["Enums"]["message_role"]
          user_id: string
        }
        Insert: {
          attachment_type?: string | null
          attachment_url?: string | null
          content: string
          created_at?: string
          id?: string
          metadata?: Json | null
          related_transaction_id?: string | null
          role: Database["public"]["Enums"]["message_role"]
          user_id: string
        }
        Update: {
          attachment_type?: string | null
          attachment_url?: string | null
          content?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          related_transaction_id?: string | null
          role?: Database["public"]["Enums"]["message_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_related_transaction_id_fkey"
            columns: ["related_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_bills: {
        Row: {
          active: boolean
          amount_kind: string
          category_id: string | null
          created_at: string
          default_account_id: string | null
          due_day: number
          expected_amount: number
          id: string
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          amount_kind?: string
          category_id?: string | null
          created_at?: string
          default_account_id?: string | null
          due_day: number
          expected_amount: number
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          amount_kind?: string
          category_id?: string | null
          created_at?: string
          default_account_id?: string | null
          due_day?: number
          expected_amount?: number
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_bills_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_bills_default_account_id_fkey"
            columns: ["default_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      index_rates: {
        Row: {
          annual_rate: number
          code: string
          id: string
          reference_date: string
          source: string | null
          updated_at: string
        }
        Insert: {
          annual_rate: number
          code: string
          id?: string
          reference_date: string
          source?: string | null
          updated_at?: string
        }
        Update: {
          annual_rate?: number
          code?: string
          id?: string
          reference_date?: string
          source?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      installment_plans: {
        Row: {
          account_id: string | null
          category_id: string | null
          created_at: string
          description: string
          id: string
          installment_amount: number
          start_date: string
          total_amount: number
          total_installments: number
          user_id: string
        }
        Insert: {
          account_id?: string | null
          category_id?: string | null
          created_at?: string
          description: string
          id?: string
          installment_amount: number
          start_date: string
          total_amount: number
          total_installments: number
          user_id: string
        }
        Update: {
          account_id?: string | null
          category_id?: string | null
          created_at?: string
          description?: string
          id?: string
          installment_amount?: number
          start_date?: string
          total_amount?: number
          total_installments?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      investment_assets: {
        Row: {
          account_id: string | null
          archived: boolean
          created_at: string
          id: string
          indexer: Database["public"]["Enums"]["asset_indexer"]
          institution: string | null
          maturity_date: string | null
          name: string
          notes: string | null
          rate: number | null
          ticker: string | null
          type: Database["public"]["Enums"]["asset_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          archived?: boolean
          created_at?: string
          id?: string
          indexer?: Database["public"]["Enums"]["asset_indexer"]
          institution?: string | null
          maturity_date?: string | null
          name: string
          notes?: string | null
          rate?: number | null
          ticker?: string | null
          type?: Database["public"]["Enums"]["asset_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          archived?: boolean
          created_at?: string
          id?: string
          indexer?: Database["public"]["Enums"]["asset_indexer"]
          institution?: string | null
          maturity_date?: string | null
          name?: string
          notes?: string | null
          rate?: number | null
          ticker?: string | null
          type?: Database["public"]["Enums"]["asset_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      investment_movements: {
        Row: {
          amount: number
          asset_id: string
          created_at: string
          id: string
          notes: string | null
          occurred_on: string
          quantity: number | null
          type: Database["public"]["Enums"]["movement_type"]
          unit_price: number | null
          user_id: string
        }
        Insert: {
          amount: number
          asset_id: string
          created_at?: string
          id?: string
          notes?: string | null
          occurred_on?: string
          quantity?: number | null
          type: Database["public"]["Enums"]["movement_type"]
          unit_price?: number | null
          user_id: string
        }
        Update: {
          amount?: number
          asset_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          occurred_on?: string
          quantity?: number | null
          type?: Database["public"]["Enums"]["movement_type"]
          unit_price?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investment_movements_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "investment_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      investment_snapshots: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          market_value: number
          snapshot_date: string
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          market_value: number
          snapshot_date?: string
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          market_value?: number
          snapshot_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investment_snapshots_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "investment_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          account_id: string
          closing_date: string
          created_at: string
          due_date: string
          id: string
          paid_at: string | null
          reference_month: number
          reference_year: number
          status: Database["public"]["Enums"]["invoice_status"]
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          closing_date: string
          created_at?: string
          due_date: string
          id?: string
          paid_at?: string | null
          reference_month: number
          reference_year: number
          status?: Database["public"]["Enums"]["invoice_status"]
          total_amount?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          closing_date?: string
          created_at?: string
          due_date?: string
          id?: string
          paid_at?: string | null
          reference_month?: number
          reference_year?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          monthly_budget: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          monthly_budget?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          monthly_budget?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      recurring_occurrences: {
        Row: {
          amount: number | null
          created_at: string
          fixed_bill_id: string
          id: string
          reference_month: number
          reference_year: number
          status: string
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          fixed_bill_id: string
          id?: string
          reference_month: number
          reference_year: number
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          fixed_bill_id?: string
          id?: string
          reference_month?: number
          reference_year?: number
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_occurrences_fixed_bill_id_fkey"
            columns: ["fixed_bill_id"]
            isOneToOne: false
            referencedRelation: "fixed_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_occurrences_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          ai_raw: Json | null
          amount: number
          attachment_url: string | null
          audit_level: Database["public"]["Enums"]["audit_level"] | null
          audit_reason: string | null
          category_id: string | null
          created_at: string
          description: string
          fixed_bill_id: string | null
          id: string
          installment_number: number | null
          installment_plan_id: string | null
          invoice_id: string | null
          occurred_on: string
          source: string
          status: Database["public"]["Enums"]["transaction_status"]
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          ai_raw?: Json | null
          amount: number
          attachment_url?: string | null
          audit_level?: Database["public"]["Enums"]["audit_level"] | null
          audit_reason?: string | null
          category_id?: string | null
          created_at?: string
          description: string
          fixed_bill_id?: string | null
          id?: string
          installment_number?: number | null
          installment_plan_id?: string | null
          invoice_id?: string | null
          occurred_on?: string
          source?: string
          status?: Database["public"]["Enums"]["transaction_status"]
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          ai_raw?: Json | null
          amount?: number
          attachment_url?: string | null
          audit_level?: Database["public"]["Enums"]["audit_level"] | null
          audit_reason?: string | null
          category_id?: string | null
          created_at?: string
          description?: string
          fixed_bill_id?: string | null
          id?: string
          installment_number?: number | null
          installment_plan_id?: string | null
          invoice_id?: string | null
          occurred_on?: string
          source?: string
          status?: Database["public"]["Enums"]["transaction_status"]
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_fixed_bill_id_fkey"
            columns: ["fixed_bill_id"]
            isOneToOne: false
            referencedRelation: "fixed_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_installment_plan_id_fkey"
            columns: ["installment_plan_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      recompute_invoice_total: {
        Args: { p_invoice: string }
        Returns: undefined
      }
    }
    Enums: {
      account_type: "cash" | "checking" | "savings" | "credit_card" | "other"
      asset_indexer: "cdi" | "ipca" | "selic" | "prefixed" | "none"
      asset_type:
        | "fixed_income"
        | "stock"
        | "reit"
        | "crypto"
        | "fund"
        | "treasury"
        | "other"
      audit_level: "green" | "yellow" | "red"
      invoice_status: "open" | "closed" | "paid"
      message_role: "user" | "assistant" | "system"
      movement_type:
        | "deposit"
        | "withdrawal"
        | "interest"
        | "dividend"
        | "fee"
        | "tax"
      transaction_status: "pending" | "paid" | "received" | "scheduled"
      transaction_type: "expense" | "income" | "transfer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["cash", "checking", "savings", "credit_card", "other"],
      asset_indexer: ["cdi", "ipca", "selic", "prefixed", "none"],
      asset_type: [
        "fixed_income",
        "stock",
        "reit",
        "crypto",
        "fund",
        "treasury",
        "other",
      ],
      audit_level: ["green", "yellow", "red"],
      invoice_status: ["open", "closed", "paid"],
      message_role: ["user", "assistant", "system"],
      movement_type: [
        "deposit",
        "withdrawal",
        "interest",
        "dividend",
        "fee",
        "tax",
      ],
      transaction_status: ["pending", "paid", "received", "scheduled"],
      transaction_type: ["expense", "income", "transfer"],
    },
  },
} as const