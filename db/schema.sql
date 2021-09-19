-- Creates application schema

--
-- SCHEMA: [Stellar]
--
IF NOT EXISTS (SELECT [name] FROM [sys].[schemas] WHERE [name] = 'Stellar')
BEGIN
    EXECUTE('CREATE SCHEMA [Stellar]');
END

GO

--
-- TABLE: [Stellar].[Users]
-- SEQUENCE: [Stellar].[UserID]
--
IF NOT EXISTS (SELECT 1 FROM [INFORMATION_SCHEMA].[SEQUENCES] WHERE [SEQUENCE_SCHEMA] = 'Stellar' AND [SEQUENCE_NAME] = 'UserID')
CREATE SEQUENCE [Stellar].[UserID] AS INT START WITH 101 INCREMENT BY 1;

IF NOT EXISTS (SELECT 1 FROM [INFORMATION_SCHEMA].[TABLES] WHERE [TABLE_SCHEMA] = 'Stellar' AND [TABLE_NAME] = 'Users')
CREATE TABLE [Stellar].[Users] (
    [UserID]    INT           CONSTRAINT [DF_Stellar_Users_UserID] DEFAULT (NEXT VALUE FOR [Stellar].[UserID]) NOT NULL,
    [UserName]  NVARCHAR(50)  NOT NULL,
    [Password]  NVARCHAR(100) NOT NULL,
    [Balance]   BIGINT        NOT NULL,
    CONSTRAINT [PK_Stellar_Users] PRIMARY KEY CLUSTERED ([UserID] ASC),
    CONSTRAINT [UQ_Stellar_Users_UserName] UNIQUE NONCLUSTERED ([UserName] ASC),
);

--
-- TABLE: [Stellar].[ApiKeys]
--
IF NOT EXISTS (SELECT 1 FROM [INFORMATION_SCHEMA].[TABLES] WHERE [TABLE_SCHEMA] = 'Stellar' AND [TABLE_NAME] = 'ApiKeys')
CREATE TABLE [Stellar].[ApiKeys] (
    [UserID] INT           NOT NULL,
    [ApiKey] NVARCHAR(100) NOT NULL,
    CONSTRAINT [PK_Stellar_ApiKeys] PRIMARY KEY CLUSTERED ([UserID] ASC),
    CONSTRAINT [FK_Stellar_ApiKeys_UserID_Stellar_Users] FOREIGN KEY ([UserID]) REFERENCES [Stellar].[Users] ([UserID]) ON DELETE CASCADE,
);

--
-- TABLE: [Stellar].[Deposits]
--
IF NOT EXISTS (SELECT 1 FROM [INFORMATION_SCHEMA].[TABLES] WHERE [TABLE_SCHEMA] = 'Stellar' AND [TABLE_NAME] = 'Deposits')
CREATE TABLE [Stellar].[Deposits] (
    [OperationID]     NVARCHAR(100) NOT NULL,
    [TransactionHash] NVARCHAR(100) NOT NULL,
    [ProcessedAt]     DATETIME2     DEFAULT (sysdatetime()) NOT NULL,
    CONSTRAINT [PK_Stellar_Operations] PRIMARY KEY CLUSTERED ([OperationID], [TransactionHash] ASC),
);

--
-- TABLE: [Stellar].[Reservations]
--
IF NOT EXISTS (SELECT 1 FROM [INFORMATION_SCHEMA].[TABLES] WHERE [TABLE_SCHEMA] = 'Stellar' AND [TABLE_NAME] = 'Reservations')
CREATE TABLE [Stellar].[Reservations] (
    [ReservationID] UNIQUEIDENTIFIER NOT NULL,
    [UserID]        INT              NOT NULL,
    [Amount]        BIGINT           NOT NULL,
    CONSTRAINT [PK_Stellar_Reservations] PRIMARY KEY CLUSTERED ([ReservationID] ASC),
    CONSTRAINT [FK_Stellar_Reservations_UserID_Stellar_Users] FOREIGN KEY ([UserID]) REFERENCES [Stellar].[Users] ([UserID]) ON DELETE CASCADE,
);

GO

--
-- STORED PROCEDURE: [Stellar].[ProcessDeposit]
--
CREATE OR ALTER PROCEDURE [Stellar].[ProcessDeposit]
    @UserID          INT,
    @Amount          INT,
    @OperationID     NVARCHAR(100),
    @TransactionHash NVARCHAR(100)
AS
SET NOCOUNT ON;
BEGIN
    MERGE [Stellar].[Deposits] AS [target]
    USING (SELECT @OperationID OperationID, @TransactionHash TransactionHash) AS [source]
        ON [source].[OperationID] = [target].[OperationID] AND
            [source].[TransactionHash] = [target].[TransactionHash]
    WHEN NOT MATCHED THEN
        INSERT ([OperationID], [TransactionHash])
        VALUES (@OperationID, @TransactionHash);

    IF @@ROWCOUNT = 1
    UPDATE TOP(1) [Stellar].[Users]
    SET [Balance] = [Balance] + @Amount
    WHERE [UserID] = @UserID;
END;

GO

--
-- STORED PROCEDURE: [Stellar].[ReservePayment]
--
CREATE OR ALTER PROCEDURE [Stellar].[ReservePayment]
    @UserID        INT,
    @ReservationID UNIQUEIDENTIFIER,
    @Amount        INT
AS
SET NOCOUNT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO [Stellar].[Reservations]
        ([ReservationID], [UserID], [Amount])
    VALUES (@ReservationID, @UserID, @Amount);

    UPDATE TOP (1) [Stellar].[Users]
    SET [Balance] = [Balance] - @Amount
    WHERE [UserID] = @UserID AND [Balance] >= @Amount;

    IF @@ROWCOUNT = 0
    RAISERROR (N'Insufficient balance', 16, 1);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
    DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
    DECLARE @ErrorState INT = ERROR_STATE();
    RAISERROR (@ErrorMessage, @ErrorSeverity, @ErrorState);
END CATCH;

GO

--
-- STORED PROCEDURE: [Stellar].[ConfirmPayment]
--
CREATE OR ALTER PROCEDURE [Stellar].[ConfirmPayment]
    @ReservationID UNIQUEIDENTIFIER
AS
BEGIN
    DELETE FROM [Stellar].[Reservations]
    WHERE [ReservationID] = @ReservationID;

    IF @@ROWCOUNT = 0
    RAISERROR (N'Reservation not found', 16, 1);
END;

GO

--
-- STORED PROCEDURE: [Stellar].[CancelPayment]
--
CREATE OR ALTER PROCEDURE [Stellar].[CancelPayment]
    @ReservationID UNIQUEIDENTIFIER
AS
SET NOCOUNT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE [Stellar].[Users]
    SET [Balance] = [Balance] + Reservations.[Amount]
    FROM [Stellar].[Users] as Users
    INNER JOIN [Stellar].[Reservations] as Reservations
        ON Users.[UserID] = Reservations.[UserID]
    WHERE Reservations.[ReservationID] = @ReservationID;

    IF @@ROWCOUNT = 0
    RAISERROR (N'Reservation or user not found', 16, 1);

    DELETE FROM [Stellar].[Reservations]
    WHERE [ReservationID] = @ReservationID;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
    DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
    DECLARE @ErrorState INT = ERROR_STATE();
    RAISERROR (@ErrorMessage, @ErrorSeverity, @ErrorState);
END CATCH;

GO
