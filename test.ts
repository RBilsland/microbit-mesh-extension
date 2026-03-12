// Test file for mesh extension - run when editing the extension directly
mesh.setGroup(42)
mesh.setMaxHops(3)
mesh.onReceived(function (message, signalStrength) {
    basic.showString(message)
})
mesh.sendMessage("hi")
