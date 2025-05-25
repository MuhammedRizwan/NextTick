const express=require('express');
const userRoute=express();
const userController=require("../controllers/userController")
const addressController=require('../controllers/addressController')
const cartController=require('../controllers/cartController')
const orderController=require('../controllers/orderController')
const wishlistController = require('../controllers/wishlistController')
const couponController = require('../controllers/couponController')


const {islogin,islogout}=require("../middlewares/auth");

userRoute.set('view engine','ejs');
userRoute.set("views", "./views/users");


const multer=require('../middlewares/multer')


userRoute.get('/',userController.loadHome);

//  registeration
userRoute.get('/register',islogout,userController.loadRegister );
userRoute.post('/register',userController.insertUser );
userRoute.get('/otp',userController.loadOtp);
userRoute.post('/otp',userController.verifyOtp)
userRoute.get('/resendOTP',userController.resendOTP)
userRoute.get('/logout',islogin,userController.userLogout)


// user login
userRoute.get('/login',islogout,userController.loadLogin );
userRoute.post('/login',userController.verifyLogin);
userRoute.get('/forget',islogout,userController.loadForgetpassword );
// userRoute.post('/otp',userController.verifyOtp)
userRoute.post('/forget',userController.forgotPasswordOTP );
userRoute.get('/resetPassword',userController.loadResetPassword)
userRoute.post('/resetPAssword',userController.resetPassword)
userRoute.post('/changePassword',userController.resetPassword)


// home
userRoute.get('/home',userController.loadHome );
userRoute.get('/shop',islogin,userController.loadShop);
userRoute.get('/shopCategoryFilter',islogin,userController.loadShopCategory );
userRoute.get('/singleProduct/:id',islogin,userController.loadSingleShop );
userRoute.get('/filterProducts',islogin,userController.filterProducts);

// user
userRoute.get('/userprofile',userController.loadProfile );
userRoute.post('/userprofile',multer.uploadUser.single('image'), userController.userEdit);
userRoute.get('/userAddress',islogin,addressController.loadAddress)
userRoute.get('/addAddress',islogin,addressController.loadAddAddress)
userRoute.post('/addAddress',islogin,addressController.addAddress)
userRoute.get('/editAddress',islogin,addressController.loadEditAddress)
userRoute.post('/editAddress',islogin,addressController.editAddress)
userRoute.get('/deleteAddress',islogin,addressController. deleteAddress)


//order
userRoute.get('/orderSuccess',islogin,orderController.loadOrderDetails)
userRoute.get('/orderDetails/:id',islogin,orderController.loadOrderHistory)
userRoute.get('/orderDetails/:id/download-pdf',islogin, orderController.downloadOrderPDF);
userRoute.get('/checkout',islogin, orderController.loadCheckout)
userRoute.post("/ordercancel",islogin, orderController.cancelOrder)
userRoute.post('/checkout',islogin,orderController.checkOutPost );
userRoute.post('/razorpayOrder',islogin,orderController.razorpayOrder)
userRoute.get('/return',islogin,orderController.userReturn)
userRoute.get('/returnData',islogin,orderController.returnOrder)


//Cart
userRoute.get('/cart',islogin, cartController.loadCartPage)
userRoute.post('/cart',islogin,cartController.addTocart)
userRoute.put('/updateCart', islogin,cartController.updateCartCount)
userRoute.delete("/removeCartItem",islogin, cartController.removeFromCart);



//Wishlist
userRoute.get('/wishlist',islogin,wishlistController.loadWishlist)
userRoute.post('/addToWishlist',islogin,wishlistController.addToWishlist)
userRoute.delete('/removeWishlist',islogin,wishlistController.removeFromWishlist)



//Coupon
userRoute.get('/coupon',islogin,couponController.userCouponList)
userRoute.post('/applyCoupon',islogin,orderController.applycoupon )



//Wallet
userRoute.get('/wallet',islogin,userController.loadWallet)

userRoute.get("/about",islogin,userController.loadAbout );
userRoute.get("/contact",islogin,userController.loadContact );


userRoute.get("/404", userController.errorPage);

module.exports=userRoute