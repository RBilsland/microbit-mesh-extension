input.onButtonPressed(Button.A, function () {
    mesh.sendString("Hello")
})
mesh.onStringReceived(function (src, msg) {
    basic.showNumber(src)
    basic.showString(msg)
})
mesh.init(123)
