-- Add account categories for non-banking assets
ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'cash_wallet';
ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'voucher';
ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'bank_balance';
ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'bank_credit';

-- Update existing accounts to new categorization
UPDATE accounts 
SET type = 'bank_balance' 
WHERE type = 'checking' OR type = 'savings';

UPDATE accounts 
SET type = 'bank_credit' 
WHERE type = 'credit_card';

-- Add category field for better organization
ALTER TABLE accounts 
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'banking' 
CHECK (category IN ('banking', 'cash', 'voucher', 'other'));

-- Add is_active flag for soft deletion
ALTER TABLE accounts 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;