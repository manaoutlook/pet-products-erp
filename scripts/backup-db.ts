
import { db } from "../db";
import { sql } from "drizzle-orm";
import * as fs from "fs";

async function generateBackupFiles() {
  try {
    console.log("Generating schema backup...");
    
    // Query to get table schemas
    const schemaResult = await db.execute(sql`
      SELECT 'CREATE TABLE IF NOT EXISTS ' || table_schema || '.' || table_name || ' (' ||
          array_to_string(
              array_agg(
                  column_name || ' ' ||  data_type || ' '|| CASE 
                      WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')'
                      ELSE ''
                  END || CASE 
                      WHEN is_nullable = 'NO' THEN ' NOT NULL'
                      ELSE ''
                  END
              ), ', '
          ) || ');'
      FROM information_schema.columns
      WHERE table_schema = 'public'
      GROUP BY table_schema, table_name;
    `);
    
    // Write schema SQL to file
    fs.writeFileSync('backup_schema.sql', schemaResult.rows.map(row => Object.values(row)[0]).join('\n'));
    console.log("Schema backup created: backup_schema.sql");
    
    // Query to get table data
    // This is a simplified version and may need adjustments for your actual data
    const tables = await db.execute(sql`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    
    let dataSQL = '';
    
    // For each table, get all data
    for (const tableRow of tables.rows) {
      const tableName = tableRow.table_name;
      console.log(`Getting data for table: ${tableName}...`);
      
      const data = await db.execute(sql`SELECT * FROM ${sql.raw(tableName)}`);
      
      if (data.rows.length > 0) {
        // Get column names
        const columns = Object.keys(data.rows[0]).join(', ');
        
        // Generate INSERT statements
        const values = data.rows.map(row => {
          const rowValues = Object.values(row).map(val => {
            if (val === null) return 'NULL';
            if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
            if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
            return val;
          }).join(', ');
          
          return `(${rowValues})`;
        }).join(',\n');
        
        if (values.length > 0) {
          dataSQL += `-- Table: ${tableName}\n`;
          dataSQL += `INSERT INTO ${tableName} (${columns}) VALUES\n${values};\n\n`;
        }
      }
    }
    
    // Write data SQL to file
    fs.writeFileSync('backup_data.sql', dataSQL);
    console.log("Data backup created: backup_data.sql");
    
    console.log("Backup complete! Files created: backup_schema.sql and backup_data.sql");
  } catch (error) {
    console.error("Error generating backup:", error);
  } finally {
    process.exit(0);
  }
}

generateBackupFiles();
