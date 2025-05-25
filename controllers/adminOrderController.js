const Order = require("../models/orderModel");
const Product = require("../models/productModel");
const Transaction = require("../models/transactionModel");
const dateFun = require("../utils/dateData");
const STATUSCODE = require("../config/statusCode");
const RESPONSE = require("../config/responseMessage");
const PDFDocument = require('pdfkit');
const fs = require('fs');

const listUserOrders = async (req, res) => {
  try {
    const admin = req.session.adminData;
    const page = parseInt(req.query.page) || 1;
    const pageSize = 7;
    const totalCount = await Order.countDocuments();
    const totalPages = Math.ceil(totalCount / pageSize);

    const orders = await Order.aggregate([
      { $sort: { _id: -1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      { $lookup: { from: "addresses", localField: "address", foreignField: "_id", as: "address" } },
      { $unwind: "$address" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "populatedProducts"
        }
      },
      {
        $addFields: {
          items: {
            $map: {
              input: "$items",
              as: "item",
              in: {
                $mergeObjects: [
                  "$$item",
                  {
                    product: {
                      $arrayElemAt: [
                        "$populatedProducts",
                        {
                          $indexOfArray: ["$populatedProducts._id", "$$item.product"]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        }
      },
      { $project: { populatedProducts: 0 } }
    ]);

    res.status(STATUSCODE.OK).render("allOrder", { order: orders, currentPage: page, totalPages, admin });
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.SERVER_ERROR);
  }
};

const listOrderDetails = async (req, res) => {
  try {
    const orderId = req.query.orderId;
    if (!orderId) {
      return res.status(STATUSCODE.BAD_REQUEST).send(RESPONSE.ORDER_ID_MISSING);
    }

    const order = await Order.findById(orderId)
      .populate("user")
      .populate({ path: "address", model: "Address" })
      .populate({ path: "items.product", model: "Product" });

    if (!order) {
      return res.status(STATUSCODE.NOT_FOUND).send(RESPONSE.ORDER_NOT_FOUND);
    }

    res.status(STATUSCODE.OK).render("orderDetails", { order });
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.SERVER_ERROR);
  }
};

const orderStatusChange = async (req, res) => {
  try {
    const orderStatus = req.query.status;
    const orderId = req.query.orderId;
    const order = await Order.findById(orderId).populate({ path: "items.product", model: "Product" });

    if (!order) {
      return res.status(STATUSCODE.NOT_FOUND).send(RESPONSE.ORDER_NOT_FOUND);
    }

    if (orderStatus === "Product Cancel") {
      const productId = req.query.productId;
      const itemToUpdate = order.items.find((item) => item.product._id.toString() === productId);
      if (itemToUpdate) {
        itemToUpdate.status = "Cancel Requested";
        await order.save();
        return res.status(STATUSCODE.OK).redirect(`/admin/orderDetails?orderId=${orderId}`);
      }
    }

    if (orderStatus === "Cancelled") {
      for (const item of order.items) {
        const product = await Product.findById(item.product._id);
        if (product) {
          product.stock += item.quantity;
          await product.save();
        }
      }
      order.paymentStatus = order.paymentMethod === "CashOnDelivery" ? "Declined" : "Refunded"; 
    }

    if (orderStatus === "Delivered") {
      order.deliveryDate = new Date();
      order.paymentStatus = order.paymentMethod === "CashOnDelivery" ? "success" : order.paymentStatus;
    }

    order.status = orderStatus;
    if (req.query.reason) {
      order.reason = req.query.reason;
    }

    await order.save();

    if (req.query.orderDetails || order.status === "Return Requested" || order.status === "Cancel Requested") {
      res.status(STATUSCODE.OK).redirect(`/admin/orderDetails?orderId=${orderId}`);
    } else {
      res.status(STATUSCODE.OK).redirect("/admin/allOrder");
    }
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.SERVER_ERROR);
  }
};

const loadSalesReport = async (req, res) => {
  try {
    let query = {};


    query.$or = [
      { status: "Delivered" }, 
      { paymentStatus: "success" } 
    ];

    if (req.query.startDate && req.query.endDate) {
      const adjustedEndDate = new Date(req.query.endDate);
      adjustedEndDate.setHours(23, 59, 59, 999);
      query.orderDate = {
        $gte: new Date(req.query.startDate),
        $lte: adjustedEndDate,
      };
    } else if (req.query.status === "All") {
      // Already handled by the $or condition above
    } else {
      if (req.query.status === "Daily") {
        query.orderDate = dateFun.getDailyDateRange();
      } else if (req.query.status === "Weekly") {
        query.orderDate = dateFun.getWeeklyDateRange();
      } else if (req.query.status === "Monthly") {
        query.orderDate = dateFun.getMonthlyDateRange();
      } else if (req.query.status === "Yearly") {
        query.orderDate = dateFun.getYearlyDateRange();
      }
    }

    const orders = await Order.find(query).populate("user").sort({ orderDate: -1 });

    const totalRevenue = orders.reduce((acc, order) => acc + order.totalAmount, 0);
    const totalSales = orders.length;
    const totalProductsSold = orders.reduce((acc, order) => acc + order.items.length, 0);

    res.status(STATUSCODE.OK).render("salesReport", {
      orders,
      totalRevenue,
      totalSales,
      totalProductsSold,
      req,
    });
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.ERROR_FETCHING_ORDERS);
  }
};

const transactionList = async (req, res) => {
  try {
    const admin = req.session.adminData;
    const page = parseInt(req.query.page) || 1;
    let query = {};
    if (req.query.type) {
      query.type = req.query.type;
    }

    const limit = 7;
    const totalCount = await Transaction.countDocuments(query);
    const transactions = await Transaction.aggregate([
      { $match: query },
      { $sort: { date: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]);

    res.status(STATUSCODE.OK).render("transactionList", {
      transactions,
      admin,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
    });
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.SERVER_ERROR);
  }
};

const downloadSalesReportPDF = async (req, res) => {
  try {
    let query = {};

    
    query.$or = [
      { status: "Delivered" }, 
      { paymentStatus: "success" } 
    ];

    if (req.query.startDate && req.query.endDate) {
      const adjustedEndDate = new Date(req.query.endDate);
      adjustedEndDate.setHours(23, 59, 59, 999);
      query.orderDate = {
        $gte: new Date(req.query.startDate),
        $lte: adjustedEndDate,
      };
    } else if (req.query.status === "All") {
    } else {
      if (req.query.status === "Daily") {
        query.orderDate = dateFun.getDailyDateRange();
      } else if (req.query.status === "Weekly") {
        query.orderDate = dateFun.getWeeklyDateRange();
      } else if (req.query.status === "Monthly") {
        query.orderDate = dateFun.getMonthlyDateRange();
      } else if (req.query.status === "Yearly") {
        query.orderDate = dateFun.getYearlyDateRange();
      }
    }

    const orders = await Order.find(query).populate("user").sort({ orderDate: -1 });

    const totalRevenue = orders.reduce((acc, order) => acc + order.totalAmount, 0);
    const totalSales = orders.length;
    const totalProductsSold = orders.reduce((acc, order) => acc + order.items.length, 0);

    const doc = new PDFDocument({ margin: 50 });
    const filename = 'SalesReport.pdf';

    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');

    doc.pipe(res);

    doc.fontSize(20).text('Sales Report', { align: 'center' });
    doc.moveDown();

    doc.fontSize(14).text(`Total Revenue: ₹ ${totalRevenue.toFixed(2)}`);
    doc.text(`Total Orders: ${totalSales}`);
    doc.text(`Total Items Sold: ${totalProductsSold}`);
    doc.moveDown();


    doc.fontSize(12).text('Order ID    Billing Name    Ordered Date    Delivery Date    Total    Status    Payment Method', {
      underline: true,
    });
    doc.moveDown(0.5);

    orders.forEach((order) => {
      const orderId = order._id.toString();
      const billingName = order.user?.name || 'N/A';
      const orderedDate = new Date(order.orderDate).toLocaleDateString();
      const deliveryDate = new Date(order.deliveryDate).toLocaleDateString();
      const total = `₹ ${order.totalAmount.toFixed(2)}`;
      const status = order.status;
      const itemsCount = order.items.length;
      const paymentMethod = order.paymentMethod || 'N/A';

      doc.fontSize(10).text(
        `${orderId.slice(-6).padEnd(10)}  ${billingName.padEnd(20)}  ${orderedDate.padEnd(20)}  ${deliveryDate.padEnd(15)}  ${total.padEnd(10)}  ${status.padEnd(15)}  ${paymentMethod}`
      );
    });

    doc.end();
  } catch (error) {
    res.status(STATUSCODE.INTERNAL_SERVER_ERROR).send(RESPONSE.ERROR_FETCHING_ORDERS);
  }
};

module.exports = {
  listUserOrders,
  listOrderDetails,
  orderStatusChange,
  loadSalesReport,
  transactionList,
  downloadSalesReportPDF
};







