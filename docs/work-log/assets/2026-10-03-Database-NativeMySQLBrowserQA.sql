-- EZERD mysql / mysql-8.4-innodb-v1; creates the entire physical design.

SET NAMES utf8mb4;

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES';

CREATE TABLE `items` (
  `item_id` INT UNSIGNED NOT NULL DEFAULT 7,
  CONSTRAINT `items_pk` PRIMARY KEY (`item_id`)
)  ENGINE=InnoDB DEFAULT CHARACTER SET=`utf8mb4` COLLATE=`utf8mb4_0900_ai_ci`;

CREATE INDEX `items_hidden_ix` ON `items` (`item_id` ASC) INVISIBLE;
