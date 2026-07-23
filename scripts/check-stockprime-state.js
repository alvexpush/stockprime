const db=require("../database");
console.log({
  welcomeSetting:db.prepare("SELECT value FROM platform_settings WHERE key=?").get("welcome_bonus_cents").value,
  welcomeBonusTransactions:db.prepare("SELECT COUNT(*) AS count FROM wallet_transactions WHERE reference=?").get("Welcome Investment Bonus").count,
  welcomeBonusRemovalMigration:db.prepare("SELECT value FROM platform_settings WHERE key=?").get("welcome_bonus_removed_v1").value,
  activePlans:db.prepare("SELECT COUNT(*) AS count FROM investment_plans WHERE status='active'").get().count
});
