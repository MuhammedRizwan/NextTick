const Address = require("../models/addressModel");
const User = require("../models/userModel");
const Order = require("../models/orderModel");
const Cart = require("../models/cartModel");
const Product = require("../models/productModel");
const Coupon = require("../models/couponModel");
const Transaction = require("../models/transactionModel");
const Wallet = require("../models/walletModel");
const mongoose = require("mongoose");
const instance = require("../config/razorPayConfig");
const STATUSCODE = require("../config/statusCode");
const RESPONSE = require("../config/responseMessage");
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { calculateSubtotal, calculateProductTotal, calculateDiscountedTotal } = require("../utils/cartSum");

function generateRandomNumberWithPrefix() {
  const prefix = "ODR";
  const randomNumber = Math.floor(Math.random() * 9000000000) + 1000000000;
  return `${prefix}${randomNumber}`;
}

const loadOrderDetails = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const userData = await User.findById(userId);
    if (!userData) {
      return res.status(STATUSCODE.OK).redirect("/login");
    }

    const page = parseInt(req.query.page) || 1;
    const pageSize = 7;
    const totalCount = await Order.countDocuments({ user: new mongoose.Types.ObjectId(userId) });

    const orders = await Order.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      { $lookup: { from: "products", localField: "items.product", foreignField: "_id", as: "items.product" } },
      { $unwind: "$items.product" },
      { $sort: { _id: -1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
    ]);

    res.status(STATUSCODE.OK).render("order", {
      userData,
      orders: orders.reverse(),
      page,
      currentPage: page,
      totalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.SERVER_ERROR);
  }
};

const loadOrderHistory = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const orderId = req.params.id;
    const userData = await User.findById(userId);
    const order = await Order.findById(orderId)
      .populate("user")
      .populate({ path: "address", model: "Address" })
      .populate({ path: "items.product", model: "Product" });

    if (!order) {
      return res.status(STATUSCODE.NOT_FOUND).send(RESPONSE.ORDER_NOT_FOUND);
    }

    res.status(STATUSCODE.OK).render("orderDetails", {
      userData,
      order,
      orderId: order._id,
      coupon: order.coupon,
    });
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.SERVER_ERROR);
  }
};

const cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(STATUSCODE.NOT_FOUND).json({ message: RESPONSE.ORDER_NOT_FOUND, success: false });
    }

    if (order.status === "Cancelled") {
      return res.status(STATUSCODE.BAD_REQUEST).json({ message: RESPONSE.ALREADY_CANCELLED, success: false });
    }

    if (order.status === "Delivered") {
      return res.status(STATUSCODE.BAD_REQUEST).json({ message: RESPONSE.DELIVERED_ORDER, success: false });
    }

    const currentDate = new Date();
    const daysDifference = Math.floor((currentDate - order.orderDate) / (1000 * 60 * 60 * 24));
    if (daysDifference > 10) {
      return res.status(STATUSCODE.BAD_REQUEST).json({ message: RESPONSE.CANCEL_TIME_EXCEEDED, success: false });
    }

    if (order.paymentMethod === "Online Payment" || order.paymentMethod === "Wallet") {
      const userId = order.user;
      const refundedAmount = order.totalAmount;
      let userWallet = await Wallet.findOne({ user: userId });

      if (!userWallet) {
        userWallet = new Wallet({
          user: userId,
          transaction: [{ amount: refundedAmount, type: "credit" }],
          walletBalance: refundedAmount,
        });
      } else {
        userWallet.transaction.push({ amount: refundedAmount, type: "credit" });
        userWallet.walletBalance += refundedAmount;
      }
      await userWallet.save();
    }

    for (const item of order.items) {
      const productData = await Product.findById(item.product);
      if (productData) {
        productData.stock += item.quantity;
        await productData.save();
      }
    }

    order.status = "Cancelled";
    order.paymentStatus = "Refunded"; // Update top-level paymentStatus
    await order.save();

    res.status(STATUSCODE.OK).json({ success: true, message: "Order cancelled successfully" });
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json({ message: RESPONSE.SERVER_ERROR, success: false });
  }
};

const loadCheckout = async (req, res) => {
  try {
    const orderId = req.query.orderId;
    const userId = req.session.user_id;
    const userData = await User.findById(userId);
    const addressData = await Address.find({ user: userId, is_listed: true });
    const currentDate = new Date();
    const coupon = await Coupon.find({ expiry: { $gt: currentDate }, is_listed: true }).sort({ createdDate: -1 });

    if (orderId) {
      const cart = await Order.findById(orderId).populate("items.product");
      if (!cart) {
        return res.status(STATUSCODE.NOT_FOUND).send(RESPONSE.ORDER_NOT_FOUND);
      }
      const validCartItems = cart.items;
      const productTotal = cart.totalAmount;
      res.status(STATUSCODE.OK).render("checkout", {
        userData,
        addressData,
        cart: validCartItems,
        productTotal,
        subtotalWithShipping: productTotal,
        coupon,
        retryTotal: productTotal,
        orderId,
      });
    } else {
      const cart = await Cart.findOne({ user: userId }).populate({ path: "items.product", model: "Product" });
      if (!cart) {
        return res.status(STATUSCODE.NOT_FOUND).send(RESPONSE.CART_NOT_FOUND);
      }

      const validCartItems = await filterOutStock(cart.items || []);
      cart.items = validCartItems;
      await cart.save();

      const subtotal = calculateSubtotal(validCartItems);
      const productTotal = calculateProductTotal(validCartItems);
      res.status(STATUSCODE.OK).render("checkout", {
        userData,
        addressData,
        cart: validCartItems,
        productTotal,
        subtotalWithShipping: subtotal,
        coupon,
        retryTotal: 0,
        orderId: "",
      });
    }
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.SERVER_ERROR);
  }
};

const filterOutStock = async (cartItems) => {
  const filteredCartItems = [];
  for (const cartItem of cartItems) {
    const product = await Product.findById(cartItem.product._id);
    if (product && product.stock > 0) {
      filteredCartItems.push(cartItem);
    }
  }
  return filteredCartItems;
};

const checkOutPost = async (req, res) => {
  try {
    const orderId = req.query.orderId;
    const userId = req.session.user_id;
    const { address, paymentMethod, couponCode, paymentStatus } = req.body;

    if (orderId) {
      await Order.findByIdAndUpdate(
        orderId,
        { paymentStatus: paymentStatus || "success" }, 
        { new: true }
      );
      return res.status(STATUSCODE.OK).json({ success: true, message: RESPONSE.ORDER_PLACED });
    }

    const user = await User.findById(userId);
    const cart = await Cart.findOne({ user: userId })
      .populate({ path: "items.product", model: "Product" })
      .populate("user");

    if (!user || !cart) {
      return res.status(STATUSCODE.NOT_FOUND).json({ success: false, error: RESPONSE.USER_NOT_FOUND });
    }

    if (!address) {
      return res.status(STATUSCODE.BAD_REQUEST).json({ error: RESPONSE.ADDRESS_NOT_SELECTED });
    }

    const cartItems = cart.items || [];
    for (const cartItem of cartItems) {
      const product = cartItem.product;
      await Product.findByIdAndUpdate(product._id, { $inc: { stock: -cartItem.quantity } });
    }

    let totalAmount = cartItems.reduce((acc, item) => {
      if (item.product.stock > 0) {
        const productPrice =
          item.product.discount_price &&
          item.product.discountStatus &&
          new Date(item.product.discountStart) <= new Date() &&
          new Date(item.product.discountEnd) >= new Date()
            ? item.product.discount_price
            : item.product.price;
        return acc + (productPrice * item.quantity || 0);
      }
      return acc;
    }, 0);

    if (couponCode) {
      totalAmount = await applyCoup(couponCode, totalAmount, userId);
    }

    let order;
    if (paymentMethod === "Wallet") {
      const walletData = await Wallet.findOne({ user: userId });
      if (!walletData) {
        return res.status(STATUSCODE.NOT_FOUND).json({ success: false, error: RESPONSE.USER_NOT_FOUND });
      }
      if (totalAmount > walletData.walletBalance) {
        return res.status(STATUSCODE.BAD_REQUEST).json({ success: false, error: RESPONSE.INSUFFICIENT_WALLET_BALANCE });
      }

      walletData.walletBalance -= totalAmount;
      walletData.transaction.push({ type: "debit", amount: totalAmount });
      await walletData.save();

      order = new Order({
        user: userId,
        orderId: generateRandomNumberWithPrefix(),
        address,
        orderDate: new Date(),
        deliveryDate: new Date(new Date().getTime() + 5 * 24 * 60 * 60 * 1000),
        totalAmount,
        coupon: couponCode,
        paymentMethod,
        paymentStatus: "success", 
        items: cartItems.map((cartItem) => ({
          product: cartItem.product._id,
          quantity: cartItem.quantity,
          size: cartItem.size,
          price:
            cartItem.product.discount_price &&
            cartItem.product.discountStatus &&
            new Date(cartItem.product.discountStart) <= new Date() &&
            new Date(cartItem.product.discountEnd) >= new Date()
              ? cartItem.product.discount_price
              : cartItem.product.price,
          status: "Confirmed",
        })),
      });
    } else if (paymentMethod === "onlinePayment") {
      order = new Order({
        user: userId,
        orderId: generateRandomNumberWithPrefix(),
        address,
        coupon: couponCode,
        orderDate: new Date(),
        deliveryDate: new Date(new Date().getTime() + 5 * 24 * 60 * 60 * 1000),
        totalAmount: req.body.amount,
        paymentMethod: "Online Payment",
        paymentStatus: paymentStatus || "success", // Set top-level paymentStatus
        items: cartItems.map((cartItem) => ({
          product: cartItem.product._id,
          quantity: cartItem.quantity,
          size: cartItem.size,
          price:
            cartItem.product.discount_price &&
            cartItem.product.discountStatus &&
            new Date(cartItem.product.discountStart) <= new Date() &&
            new Date(cartItem.product.discountEnd) >= new Date()
              ? cartItem.product.discount_price
              : cartItem.product.price,
          status: "Confirmed",
        })),
      });
    } else if (paymentMethod === "CashOnDelivery") {
      order = new Order({
        user: userId,
        orderId: generateRandomNumberWithPrefix(),
        address,
        orderDate: new Date(),
        deliveryDate: new Date(new Date().getTime() + 5 * 24 * 60 * 60 * 1000),
        totalAmount,
        paymentMethod,
        coupon: couponCode,
        paymentStatus: "Pending", 
        items: cartItems.map((cartItem) => ({
          product: cartItem.product._id,
          quantity: cartItem.quantity,
          size: cartItem.size,
          price: cartItem.product.discount_price || cartItem.product.price,
          status: "Confirmed",
        })),
      });
    } else {
      order = new Order({
        user: userId,
        orderId: generateRandomNumberWithPrefix(),
        address,
        orderDate: new Date(),
        deliveryDate: new Date(new Date().getTime() + 5 * 24 * 60 * 60 * 1000),
        totalAmount: req.body.amount,
        coupon: couponCode,
        paymentMethod,
        paymentStatus: "failed", 
        items: cartItems.map((cartItem) => ({
          product: cartItem.product._id,
          quantity: cartItem.quantity,
          size: cartItem.size,
          price:
            cartItem.product.discount_price &&
            cartItem.product.discountStatus &&
            new Date(cartItem.product.discountStart) <= new Date() &&
            new Date(cartItem.product.discountEnd) >= new Date()
              ? cartItem.product.discount_price
              : cartItem.product.price,
          status: "Payment Pending",
        })),
      });
    }

    await order.save();
    cart.items = [];
    cart.totalAmount = 0;
    await cart.save();

    res.status(STATUSCODE.OK).json({ success: true, message: RESPONSE.ORDER_PLACED });
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json({ error: RESPONSE.INVALID_PAYMENT_METHOD });
  }
};

const applycoupon = async (req, res) => {
  try {
    const { couponCode } = req.body;
    const userId = req.session.user_id;
    const coupon = await Coupon.findOne({ code: couponCode });

    if (!coupon) {
      return res.status(STATUSCODE.NOT_FOUND).json({ errorMessage: RESPONSE.COUPON_NOT_FOUND });
    }

    const currentDate = new Date();
    if (coupon.expiry && currentDate > coupon.expiry) {
      return res.status(STATUSCODE.BAD_REQUEST).json({ errorMessage: RESPONSE.COUPON_EXPIRED });
    }

    if (coupon.userUsed.length >= coupon.limit) {
      return res.status(STATUSCODE.BAD_REQUEST).json({ errorMessage: RESPONSE.COUPON_LIMIT_REACHED });
    }

    if (coupon.userUsed.includes(userId)) {
      return res.status(STATUSCODE.BAD_REQUEST).json({ errorMessage: RESPONSE.COUPON_ALREADY_USED });
    }

    const cart = await Cart.findOne({ user: userId }).populate({ path: "items.product", model: "Product" });
    const cartItems = cart.items || [];
    const orderTotal = calculateSubtotal(cartItems);

    if (coupon.minAmt > orderTotal) {
      return res.status(STATUSCODE.BAD_REQUEST).json({ errorMessage: RESPONSE.COUPON_MIN_AMOUNT });
    }

    const discountedTotal = calculateDiscountedTotal(orderTotal, coupon.discount);
    if (coupon.maxAmt < discountedTotal) {
      return res.status(STATUSCODE.BAD_REQUEST).json({ errorMessage: RESPONSE.COUPON_MAX_AMOUNT });
    }

    res.status(STATUSCODE.OK).json({ success: true, discountedTotal, message: RESPONSE.COUPON_APPLIED });
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json({ errorMessage: RESPONSE.SERVER_ERROR });
  }
};

async function applyCoup(couponCode, discountedTotal, userId) {
  const coupon = await Coupon.findOne({ code: couponCode });
  if (!coupon || new Date() > coupon.expiry || coupon.userUsed.length >= coupon.limit || coupon.userUsed.includes(userId)) {
    return discountedTotal;
  }

  discountedTotal = calculateDiscountedTotal(discountedTotal, coupon.discount);
  coupon.limit--;
  coupon.userUsed.push(userId);
  await coupon.save();
  return discountedTotal;
}

const razorpayOrder = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const { address, paymentMethod, couponCode, retryTotal } = req.body;
    const user = await User.findById(userId);
    const cart = await Cart.findOne({ user: userId })
      .populate({ path: "items.product", model: "Product" })
      .populate("user");

    if (!user || !cart) {
      return res.status(STATUSCODE.NOT_FOUND).json({ success: false, error: RESPONSE.USER_NOT_FOUND });
    }

    if (!address) {
      return res.status(STATUSCODE.BAD_REQUEST).json({ error: RESPONSE.ADDRESS_NOT_SELECTED });
    }

    const cartItems = cart.items || [];
    let totalAmount = cartItems.reduce((acc, item) => {
      const productPrice = item.product?.discount_price;
      return typeof productPrice === "number" ? acc + productPrice * item.quantity : acc;
    }, 0);

    if (couponCode) {
      totalAmount = await applyCoup(couponCode, totalAmount, userId);
    }

    const options = {
      amount: (retryTotal > 1 ? retryTotal : totalAmount) * 100,
      currency: "INR",
      receipt: `order_${Date.now()}`,
      payment_capture: 1,
    };

    const razorpayOrder = await new Promise((resolve, reject) => {
      instance.orders.create(options, (err, order) => {
        if (err) reject(err);
        else resolve(order);
      });
    });

    res.status(STATUSCODE.CREATED).json({ success: true, message: RESPONSE.ORDER_PLACED, order: razorpayOrder });
  } catch (error) {
    res.status(STATUSCODE.BAD_REQUEST).json({ success: false, error: RESPONSE.PAYMENT_FAILED });
  }
};

const userReturn = async (req, res) => {
  try {
    const orderId = req.query.orderId;
    const order = await Order.findById(orderId).populate({ path: "items.product", model: "Product" });

    if (!order) {
      return res.status(STATUSCODE.NOT_FOUND).send(RESPONSE.ORDER_NOT_FOUND);
    }

    order.status = "Return Requested";
    if (req.query.reason) {
      order.reason = req.query.reason;
    }
    await order.save();

    res.status(STATUSCODE.OK).redirect(`/orderDetails/${orderId}`);
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.SERVER_ERROR);
  }
};

const returnOrder = async (req, res) => {
  try {
    const orderId = req.query.orderId;
    const order = await Order.findById(orderId)
      .populate("user")
      .populate({ path: "items.product", model: "Product" });

    if (!order) {
      return res.status(STATUSCODE.NOT_FOUND).send(RESPONSE.ORDER_NOT_FOUND);
    }

    const user = order.user;
    let userWallet = await Wallet.findOne({ user: user._id });

    if (!userWallet) {
      userWallet = new Wallet({ user: user._id, walletBalance: 0, transaction: [] });
    }

    const refundedAmount = order.totalAmount;
    const transactionCredit = new Transaction({
      user: user._id,
      amount: refundedAmount,
      type: "credit",
      paymentMethod: order.paymentMethod,
      orderId: order._id,
      description: `Refunded to wallet for returned order`,
    });

    await transactionCredit.save();
    userWallet.transaction.push({ amount: refundedAmount, type: "credit" });
    userWallet.walletBalance += refundedAmount;
    await userWallet.save();

    for (const item of order.items) {
      const product = await Product.findById(item.product);
      if (product) {
        product.stock += item.quantity;
        await product.save();
      }
    }

    order.status = "Return Successful";
    await order.save();

    res.status(STATUSCODE.OK).redirect(`/admin/orderDetails?orderId=${orderId}`);
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json({ message: RESPONSE.SERVER_ERROR, success: false });
  }
};

const downloadOrderPDF = async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findById(orderId)
      .populate("user")
      .populate({ path: "address", model: "Address" })
      .populate({ path: "items.product", model: "Product" });

    if (!order) {
      return res.status(STATUSCODE.NOT_FOUND).send(RESPONSE.ORDER_NOT_FOUND);
    }

    // Create a new PDF document
    const doc = new PDFDocument({ margin: 50 });
    const fileName = `Order_${order.orderId}.pdf`;
    const filePath = path.join(__dirname, `../public/pdfs/${fileName}`);


    const pdfDir = path.join(__dirname, '../public/pdfs');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    // Pipe the PDF into a writable stream
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fillColor('#28a745').fontSize(20).text('Order Details', { align: 'center' });
    doc.moveDown();

    // Order Information
    doc.fillColor('#000000').fontSize(12);
    doc.text(`Order ID: ${order.orderId}`);
    doc.text(`Order Date: ${new Date(order.orderDate).toLocaleDateString('en-US', { 
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true 
    })}`);
    if (order.status !== 'failed') {
      doc.text(`Delivery Date: ${new Date(order.deliveryDate).toLocaleDateString('en-US', { 
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true 
      })}`);
    }
    doc.moveDown();

    // Customer Information
    doc.fillColor('#28a745').fontSize(14).text('Customer', { underline: true });
    doc.fillColor('#000000').fontSize(12);
    doc.text(`${order.user.name}`);
    doc.text(`${order.user.mobile}`);
    doc.moveDown();

    // Order Info
    doc.fillColor('#28a745').fontSize(14).text('Order Info', { underline: true });
    doc.fillColor('#000000').fontSize(12);
    doc.text(`Shipping: Fargo Express`);
    doc.text(`Pay Method: ${order.paymentMethod}`);
    doc.text(`Status: ${order.status}`);
    doc.moveDown();

    // Delivery Address
    doc.fillColor('#28a745').fontSize(14).text('Deliver To', { underline: true });
    doc.fillColor('#000000').fontSize(12);
    doc.text(`City: ${order.address.city}, ${order.address.street}`);
    doc.text(`${order.address.houseName}`);
    doc.text(`${order.address.pincode}`);
    doc.moveDown();


    doc.fillColor('#28a745').fontSize(14).text('Coupon Details', { underline: true });
    doc.fillColor('#000000').fontSize(12);
    if (order.coupon) {
      doc.text(`Coupon Name: ${order.coupon}`);
    } else {
      doc.text('No coupons applied');
    }
    doc.moveDown();


    doc.fillColor('#28a745').fontSize(14).text('Products', { underline: true });
    doc.moveDown();


    const tableTop = doc.y;
    const col1 = 50;  
    const col2 = 250; 
    const col3 = 350; 
    const col4 = 450; 
    const rowHeight = 30;
    const tableWidth = 550;

    doc.fillColor('#28a745').fontSize(12).font('Helvetica-Bold');
    doc.rect(col1, tableTop, tableWidth, rowHeight).fill('#28a745');
    doc.fillColor('#ffffff');
    doc.text('Product', col1 + 5, tableTop + 8, { width: 190, align: 'left' });
    doc.text('Unit Price', col2 + 5, tableTop + 8, { width: 90, align: 'right' });
    doc.text('Quantity', col3 + 5, tableTop + 8, { width: 90, align: 'right' });
    doc.text('Total', col4 + 5, tableTop + 8, { width: 90, align: 'right' });

    // Table Rows
    let currentY = tableTop + rowHeight;
    let subtotal = 0;
    doc.font('Helvetica').fillColor('#000000');

    order.items.forEach((item, index) => {
      const total = item.product.discount_price * item.quantity;
      subtotal += total;

      if (currentY + rowHeight > doc.page.height - 50) {
        doc.addPage();
        currentY = 50;
      }

      if (index % 2 === 0) {
        doc.fillColor('#f8f9fa').rect(col1, currentY, tableWidth, rowHeight).fill();
      }

      // Draw row content
      doc.fillColor('#000000');
      doc.text(item.product.name, col1 + 5, currentY + 8, { width: 190, align: 'left' });
      doc.text(`₹${item.product.discount_price}`, col2 + 5, currentY + 8, { width: 90, align: 'right' });
      doc.text(`${item.quantity}`, col3 + 5, currentY + 8, { width: 90, align: 'right' });
      doc.text(`₹${total}`, col4 + 5, currentY + 8, { width: 90, align: 'right' });

      // Draw row border
      doc.lineWidth(0.5).rect(col1, currentY, tableWidth, rowHeight).stroke();

      currentY += rowHeight;
    });

    // Draw table border
    doc.lineWidth(1).rect(col1, tableTop, tableWidth, currentY - tableTop).stroke();

    // Totals
    doc.moveDown();
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000');
    doc.text(`Subtotal: ₹${subtotal}`, 400, currentY + 10, { width: 150, align: 'right' });
    doc.text('Shipping Cost: ₹0.00', 400, currentY + 30, { width: 150, align: 'right' });
    doc.text(`Grand Total: ₹${subtotal}`, 400, currentY + 50, { width: 150, align: 'right' });
    doc.text(`Status: ${order.status}`, 400, currentY + 70, { width: 150, align: 'right' });

    doc.end();

    stream.on('finish', () => {
      res.download(filePath, fileName, (err) => {
        if (err) {
          console.error('Error downloading PDF:', err);
          res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.SERVER_ERROR);
        }
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error('Error deleting PDF file:', unlinkErr);
        });
      });
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.SERVER_ERROR);
  }
};

module.exports = {
  loadOrderDetails,
  loadOrderHistory,
  cancelOrder,
  loadCheckout,
  checkOutPost,
  applycoupon,
  razorpayOrder,
  returnOrder,
  userReturn,
  downloadOrderPDF
};