update asset_type
   set name = '계좌',
       updated_at = current_timestamp,
       version = version + 1
 where system_code = 'BANK'
   and name is distinct from '계좌';
