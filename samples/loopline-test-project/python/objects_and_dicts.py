class Account:
    def __init__(self, owner, balance):
        self.owner = owner
        self.balance = balance

    def deposit(self, amount):
        self.balance += amount
        return self.balance


acct = Account("Ada", 100)
history = {"deposits": [], "count": 0}
for amount in (25, 50):
    new_balance = acct.deposit(amount)
    history["deposits"].append(amount)
    history["count"] += 1
print(acct.owner, acct.balance, history)
