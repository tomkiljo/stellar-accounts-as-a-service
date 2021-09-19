-- Creates an user from login with access to app database

IF NOT EXISTS (SELECT 1 FROM [sys].[database_principals] WHERE [name] = 'db_executor' AND [type] = 'R')
BEGIN
    CREATE ROLE db_executor;
    GRANT EXECUTE ON SCHEMA::[Stellar] TO db_executor;
END

DECLARE @Username NVARCHAR(30) = 'app'

IF NOT EXISTS (SELECT [name] FROM [sys].[database_principals] WHERE [name] = @Username)
BEGIN
    EXECUTE ('CREATE USER ' + @Username + ' FROM LOGIN ' + @Username);
    EXEC sp_addrolemember 'db_datareader', @Username;
    EXEC sp_addrolemember 'db_datawriter', @Username;
    EXEC sp_addrolemember 'db_executor', @Username;
END
