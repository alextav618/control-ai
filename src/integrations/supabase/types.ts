// Database type for Supabase client (minimal version to satisfy imports)
export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          type: 'checking' | 'savings' | 'credit_card' | 'cash' | 'voucher' | 'other';
          current_balance: number;
          closing_day: number | null;
          due_day: number | null;
          credit_limit: number | null;
          archived: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          type: 'checking' | 'savings' | 'credit_card' | 'cash' | 'voucher' | 'other';
          current_balance?: number;
          closing_day?: number | null;
          due_day?: number | null;
          credit_limit?: number | null;
          archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          type?: 'checking' | 'savings' | 'credit_card' | 'cash' | 'voucher' | 'other';
          current_balance?: number;
          closing_day?: number | null;
          due_day?: number | null;
          credit_limit?: number | null;
          archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      transactions: {
        Row: {
          id: string;
          user_id: string;
          type: 'expense' | 'income' | 'transfer';
          amount: number;
          description: string;
          occurred_on: string;
          account_id: string | null;
          category_id: string | null;
          fixed_bill_id: string | null;
          invoice_id: string | null;
          status: 'pending' | 'paid' | 'cancelled';
          source: 'manual' | 'chat' | 'recurring';
          transfer_from_account_id: string | null;
          transfer_to_account_id: string | null;
          audit_level: 'green' | 'yellow' | 'red' | null;
          audit_reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: 'expense' | 'income' | 'transfer';
          amount: number;
          description: string;
          occurred_on: string;
          account_id?: string | null;
          category_id?: string | null;
          fixed_bill_id?: string | null;
          invoice_id?: string | null;
          status?: 'pending' | 'paid' | 'cancelled';
          source?: 'manual' | 'chat' | 'recurring';
          transfer_from_account_id?: string | null;
          transfer_to_account_id?: string | null;
          audit_level?: 'green' | 'yellow' | 'red' | null;
          audit_reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: 'expense' | 'income' | 'transfer';
          amount?: number;
          description?: string;
          occurred_on?: string;
          account_id?: string | null;
          category_id?: string | null;
          fixed_bill_id?: string | null;
          invoice_id?: string | null;
          status?: 'pending' | 'paid' | 'cancelled';
          source?: 'manual' | 'chat' | 'recurring';
          transfer_from_account_id?: string | null;
          transfer_to_account_id?: string | null;
          audit_level?: 'green' | 'yellow' | 'red' | null;
          audit_reason?: string | null;
          created_at?: string;
        };
      };
      // ... other tables remain the same
    };
    Enums: {
      account_type: 'checking' | 'savings' | 'credit_card' | 'cash' | 'voucher' | 'other';
      transaction_type: 'expense' | 'income' | 'transfer';
      transaction_status: 'pending' | 'paid' | 'cancelled';
      transaction_source: 'manual' | 'chat' | 'recurring';
      audit_level: 'green' | 'yellow' | 'red';
    };
    CompositeTypes: Record<string, any>;
  };
};

// Helper types referenced by Enums
type DefaultSchema = Database['public'];
type DatabaseWithoutInternals = Database;

// Fixed Enums type using the defined helper types
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