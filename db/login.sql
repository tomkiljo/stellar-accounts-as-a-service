-- Creates a login for Azure SQL Database in the master database

DECLARE @Username NVARCHAR(30) = 'app'

IF NOT EXISTS (SELECT [name] FROM [master].[sys].[server_principals] WHERE [name] = @Username)
BEGIN
    -- Create a random password
    DECLARE @Password NVARCHAR(100) = '';
    WHILE LEN(@Password) < 32
    BEGIN
        DECLARE @Index INT = ROUND(33 + RAND() * (122-33),0);
        IF (@Index >= 33 AND @Index <= 57)  OR
           (@Index >= 65 AND @Index <= 90)  OR
           (@Index >= 97 AND @Index <= 122)
        BEGIN
            SET @Password += CHAR(@Index);
        END
    END

    EXECUTE ('CREATE LOGIN [' + @Username+ '] WITH PASSWORD = N''' + @Password + '''');
    PRINT 'Created login ''' + @Username + ''' with password ''' + @Password + '''';
END
