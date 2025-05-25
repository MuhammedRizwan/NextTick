const mongoose = require('mongoose');

function generateRandomNumberWithPrefix() {
  let prefix = "ODR";
  const randomNumber = Math.floor(Math.random() * 9000000000) + 1000000000;
  const result = `${prefix}${randomNumber}`;
  console.log("random orderid:-", result);
  return result;
}

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    default: generateRandomNumberWithPrefix,
    unique: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  address: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address',
  },
  orderDate: {
    type: Date,
    default: Date.now,
  },
  deliveryDate: {
    type: Date,
  },
  coupon: {
    type: String,
  },
  shipping: {
    type: String,
    default: 'Free Shipping',
  },
  status: {
    type: String,
    default: 'pending',
  },
  totalAmount: {
    type: Number,
    required: true,
  },
  paymentMethod: {
    type: String,
    required: true,
  },
  adminApproval: {
    type: Boolean,
    default: false,
  },
  reason: {
    type: String,
  },
  paymentStatus: {
    type: String,
    enum: ["success", "failed", "Pending"],
    default: "Pending",
  },
  items: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
      },
      quantity: { type: Number, required: true },
      price: { type: Number, required: true },
      status: {
        type: String,
        enum: ['Confirmed', 'Pending', 'Shipped', 'Delivered', 'Payment Pending'],
        default: 'Confirmed',
      },
    },
  ],
  returnStatus: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending',
  },
});

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;