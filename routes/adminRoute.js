const express = require("express");
const adminRoute = express();
const multer=require('../middlewares/multer')
const adminController = require("../controllers/adminController");
const categoryController=require("../controllers/categoryController");
const productController=require('../controllers/productController')
const couponController = require('../controllers/couponController')
const offerController = require('../controllers/offerController')
const orderController = require('../controllers/orderController')
const adminOrderController=require('../controllers/adminOrderController')
const bannerController= require('../controllers/bannerController')
const adminAuth = require("../middlewares/adminAuth");
const { bannerUpload } = require('../middlewares/multer');



adminRoute.set('view engine','ejs');
adminRoute.set("views", "./views/admin");


// LOGIN
adminRoute.get("/",adminAuth.islogout, adminController.adminLogin);
// adminRoute.get("/logout", adminController.adminLogout);
adminRoute.post("/",adminAuth.islogout, adminController.verifyLogin);



// HOME
adminRoute.get("/home",adminAuth. islogin,adminController.loadHome);


// user
adminRoute.get("/userDashboard",adminAuth.islogin,  adminController.loadUserpage);
adminRoute.get('/unlistUser',adminAuth.islogin,adminController.listUser)




adminRoute.get("/category",adminAuth.islogin,categoryController.loadCategory);
adminRoute.get("/addCategory",adminAuth.islogin, categoryController.loadCategoryform);
adminRoute.post("/addCategory",adminAuth.islogin,categoryController.addCategory);

adminRoute.get("/editCategory",adminAuth.islogin,categoryController.loadEditCategory);
adminRoute.post("/editCategory",multer.uploadCategory.single('image'), categoryController.CategoryEdit);
adminRoute.get('/unlistCategory',adminAuth.islogin,categoryController.unlistCategory)



adminRoute.get("/products",adminAuth.islogin, productController.loadProducts)
adminRoute.get("/addproduct",adminAuth.islogin, productController.loadProductForm)
adminRoute.post("/addproduct",multer.uploadProduct.array('image'), productController.addProduct)
adminRoute.get("/deleteProduct",adminAuth.islogin,productController.deleteProduct)
adminRoute.get("/editProduct",adminAuth.islogin, productController.loadEditProductForm)
adminRoute.post("/editProduct",multer.uploadProduct.array('image'), productController.storeEditProduct)
adminRoute.get("/removeImage",adminAuth.islogin,productController.removeImage)



adminRoute.get("/allOrder",adminAuth.islogin,adminOrderController.listUserOrders)
adminRoute.get("/orderDetails",adminAuth.islogin,adminOrderController.listOrderDetails)
adminRoute.get("/orderStatus",adminAuth.islogin,adminOrderController.orderStatusChange)
adminRoute.get("/salesReport",adminAuth.islogin,adminOrderController.loadSalesReport)
adminRoute.get('/salesReport/downloadPDF',adminAuth.islogin,adminOrderController.downloadSalesReportPDF);
adminRoute.get('/refundOrder',adminAuth.islogin,orderController.returnOrder)
adminRoute.get("/transactionList",adminAuth.islogin,adminOrderController.transactionList)


adminRoute.get("/couponAdd",adminAuth.islogin,couponController.loadCoupon)
adminRoute.get("/couponList",adminAuth.islogin,couponController.loadCouponList)
adminRoute.get("/couponEdit",adminAuth.islogin,couponController.loadEditCoupon );
adminRoute.put("/couponEdit",couponController.editCoupon );
adminRoute.get("/couponUnlist",adminAuth.islogin, couponController.unlistCoupon);
adminRoute.get("/couponDetails",adminAuth.islogin,couponController.coupoonDetails);
adminRoute.post("/couponAdd",couponController.addCoupon);


adminRoute.get("/addOffer",adminAuth.islogin,offerController.loadOfferAdd);
adminRoute.get("/offerList",adminAuth.islogin,offerController.OfferList);
adminRoute.get("/offerEdit", adminAuth.islogin,offerController.loadOfferEdit);
adminRoute.get("/blockOffer",adminAuth.islogin,offerController.offerBlock);
adminRoute.post("/addOffer", offerController.addOffer);
adminRoute.post("/editOffer",adminAuth.islogin,offerController.editOffer);


adminRoute.get("/bannerAdd", adminAuth.islogin, bannerController.loadBannerAdd);
adminRoute.get("/bannerList", adminAuth.islogin, bannerController.bannerList);
adminRoute.get("/bannerEdit", adminAuth.islogin, bannerController.loadBannerEdit);
adminRoute.get('/blockBanner',adminAuth.islogin,bannerController.blockBanner)
adminRoute.post("/bannerAdd",bannerUpload.single("image"),bannerController.addBanner);
adminRoute.post("/bannerEdit",bannerUpload.single("image"),bannerController.bannerEdit);


module.exports = adminRoute;