
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        firebaseUid: {
            type: String,
            required: true,
            unique: true,
        },
        email: {
            type: String,
            default: "",
        },
        displayName: {
            type: String,
            default: "",
        },
        coins: {
            type: Number,
            default: 150,
            min: 0,
        },
        trialGranted: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
