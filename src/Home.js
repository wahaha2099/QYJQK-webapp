import React, { Component } from 'react';
import {
    StyleSheet,
    Text,
    View,
    Dimensions,
    AppState,
    BackAndroid,
    Platform,
    ToastAndroid,
    StatusBar,
    WebView,
    Alert
} from 'react-native';
import Permissions from 'react-native-permissions';
import RNFS from 'react-native-fs';
import Camera from 'react-native-camera';
import WebViewBridge from 'react-native-webview-bridge';
import DragableOpacity from './DragableOpacity';
import ErrorPage from './ErrorPage';
import LoadingPage from './LoadingPage';
import Qiniu,{Auth,ImgOps,Conf,Rs,Rpc} from 'react-native-qiniu';


const DEFAULT_URL = 'http://www.qyjqk.com/mb/index/exam';

// 测试
// const DEFAULT_URL = 'http://www.kaasworld.com/jqk/test/mb/index/exam';


// 注入的js方法
const injectScript = `
(function () {
    if (WebViewBridge) {
         if(reactInit){
            reactInit( WebViewBridge );
        }
    }
}());
`;

export default class Home extends Component {
    constructor(props){
        super(props);

        this.backButtonEnabled = false;
        this.forwardButtonEnabled = false;

        // 拍照次数
        this.count = 0;

        this.state = {
            showCamera: false,
            types: [],
        };
    }

    // 生命周期方法 组件将挂载
    componentWillMount(){
        // 添加返回键的监听
        if (Platform.OS === 'android') {
            try {
                BackAndroid.addEventListener('hardwareBackPress', this.onBackAndroid.bind(this));
            }
            catch (error) {
                if(__DEV__) console.log('add event listener error', error.message);
            }
        }

        try {
            this.lastAppState = AppState.currentState;
            AppState.addEventListener('change', this.onAppStateChange.bind(this));
        }
        catch (error){
            if(__DEV__) console.log('add AppState listener error', error.message);
        }

        //test
        //this.state.showCamera = true;


        // 更新权限状态
        this.updatePermission();

        // 检查摄像头权限
        this.checkCameraPermission();
        setInterval(()=>this.checkCameraPermission(), 5000);

    }

    // 生命周期方法 组件将卸载
    componentWillUnmount(){
        if(Platform.OS == 'android'){
            try {
                BackAndroid.removeEventListener('hardwareBackPress', this.onBackAndroid.bind(this));
            }
            catch (error){
                if(__DEV__) console.log('remove event listener error', error.message);
            }
        }

        try{
            AppState.removeEventListener('change', this.onAppStateChange.bind(this));
        }
        catch(error){
            if(__DEV__) console.log('remove AppState listener error', error.message);
        }
    }

    // ----------- 自定义方法 -------------

    // webview桥接受msg方法
    onBridgeMessage(message){
        if(message){
            this.getDataFromMessage(message);
        }
    }

    /**
     * 更新权限状态信息
     */
    updatePermission() {
        try {
            let types = Permissions.getPermissionTypes();
            Permissions.checkMultiplePermissions(types)
                .then(permissions => {
                    this.setState({...permissions});
                });
        }
        catch (error){
            if(__DEV__) console.log('get permissions error', error.message);
        }
    }

    /**
     * 检查摄像头权限
     */
    checkCameraPermission() {
        try {
            Permissions.requestPermission('camera')
                .then(permission => {
                    if (permission != 'authorized') {
                        Alert.alert(
                            '摄像头权限未开启',
                            "请在应用权限中勾选摄像头",
                            [
                                // {text: '关闭', style: 'cancel'},
                                {text: '打开设置', onPress: Permissions.openSettings },
                            ]
                        )
                    }
                    else {
                        this.setState({camera: 'authorized'});
                    }
                });
        }
        catch (error){
            if(__DEV__) console.log('set permission error', error.message);
        }
    }

    // 解析网页传过来的msg
    getDataFromMessage(message){
        let jsonObj = eval("(" + message + ")");
        try {
            this.webviewbridge.sendToBridge(`{"code": ${1}, "obj": {"msg": "v1.0.6接受js发送的msg: ${message}"}}`);

            if (jsonObj.obj) {
                this.userId = jsonObj.obj.userId,
                    this.uptoken = jsonObj.obj.token;
                this.prefix = jsonObj.obj.prefix;
                this.photoTime = jsonObj.obj.time;
                this.num = jsonObj.obj.num;
            }
        }
        catch (error) {
            if(__DEV__) console.log('parse error', error.message);
            this.webviewbridge.sendToBridge(`{"code": ${-1}, "obj": {"error": "接受解析js发送的msg异常: ${error.message}"}}`);
        }

        try {
            // code=0打开摄像头
            if (jsonObj.code == 0) {

                this.setState({showCamera: true});
                this.webviewbridge.sendToBridge(`{"code": ${1}, "obj": {"msg": "接受解析js发送的 code = 0,打开摄像头正常"}}`);

                if (this.timer) {
                    clearInterval(this.timer);
                    this.timer = null;
                    this.count = 0;
                }

                // num=0认为不需要拍照
                if (this.num == 0) {
                    return;
                }

                // 设置定时任务
                this.timer = setInterval(async function () {
                    // 如果拍照次数达到了要求次数 就销毁定时任务
                    if (this.count == this.num) {
                        clearInterval(this.timer);
                        this.timer = null;
                        this.count = 0;
                        return;
                    }
                    this.count++;
                    this.captureAndUploadImage();
                }.bind(this), (this.photoTime / this.num) * 1000);
            }
        }
        catch (error) {
            if(__DEV__) console.log('open camera error', error.message);
            this.webviewbridge.sendToBridge(`{"code": ${-1}, "obj": {"error": "打开摄像头异常: ${error.message}"}}`);
        }

        try {
            // code=1关闭摄像头
            if (jsonObj.code == 1) {
                this.setState({showCamera: false});
                this.webviewbridge.sendToBridge(`{"code": ${1}, "obj": {"msg": "接受解析js发送的 code = 1,关闭摄像头正常"}}`);

                // 销毁定时器
                if (this.timer) {
                    clearInterval(this.timer);
                    this.timer = null;
                    this.count = 0;
                }
            }
        }
        catch (error) {
            if(__DEV__) console.log('close camera error', error.message);
            this.webviewbridge.sendToBridge(`{"code": ${-1}, "obj": {"error": "关闭摄像头异常: ${error.message}"}}`);
        }
    }

    // 拍照并上传
    captureAndUploadImage(){
        if(this.camera) {
            this.camera.capture()
                .then((data) => {
                    // ios可以直接使用这个路径
                    let path = data.path;
                    // android的路径需要去掉file://
                    if(Platform.OS == 'android'){
                        path = data.path.substring(data.path.indexOf('file://') + 'file://'.length);
                    }
                    if(__DEV__) console.log('capture success');
                    this.webviewbridge.sendToBridge(`{"code": ${1}, "obj": {"msg": "读取图片的路径: ${path}"}}`);

                    // 读取文件内容
                    RNFS.stat(path)
                        .then((result) => {
                            // 结果对象
                            const image = result;

                            // 图片的大小 单位为byte
                            const size = image.size;
                            // console.log('image size---->', size);

                            if(this.uptoken) {
                                this.uploadImage(data, size);
                            }
                        })
                        .catch((error) => {
                            if(__DEV__) console.log('readDir error', error.message);
                            this.webviewbridge.sendToBridge(`{"code": ${-1}, "obj": {"error": "读取文件异常: ${error.message}"}}`);
                        });
            })
            .catch((error)=>{
                if(__DEV__) console.log("capture error", error.message);
                this.webviewbridge.sendToBridge(`{"code": ${-1}, "obj": {"error": "拍照异常: ${error.message}"}}`);
            });
        }
    }

    // 上传图片
    uploadImage(data, size){
        // 文件名称
        const name = `${this.prefix}${Date.now()}.jpg`;

        // 表单对象
        const formInput = {
            // 文件属性
            file : {uri: data.path, type: 'application/octet-stream', name: name},
            // 最终资源名称
            key: name
        };

        // 开始上传文件
        Rpc.uploadFile(data.path, this.uptoken, formInput)
            .then((response) => {
                return response.text();
            })
            .then((responseText) => {
                // 上传成功传发一次消息
                this.webviewbridge.sendToBridge(`{"code": ${0}, "obj": {"url": "${name}", "size": ${size}}, "responseText": ${responseText}}`);
                if(__DEV__) console.log('upload success', responseText);
            })
            .catch((error)=> {
                // 上传不成功就同个文件再次上传
                this.webviewbridge.sendToBridge(`{"code": ${-1}, "obj": {"error": v1.0.6上传图片异常 "${error.message}"}}`);
                // this.uploadImage(data);
                if(__DEV__) console.log('upload error', error.message);
            });
    }

    // webview的监听url变化的方法 每次url变化会触发
    onNavigationStateChange(navState) {
        this.backButtonEnabled = navState.canGoBack;
        this.forwardButtonEnabled = navState.canGoForward;
    }

    onBackAndroid() {
        // 首页返回键弹出toast
        if(!this.backButtonEnabled) {
            // 2秒内连续点击
            if (this.lastBackPressed && (this.lastBackPressed + 2000 >= Date.now())) {
                // 退出应用
                BackAndroid.exitApp();
            }
            // 其他情况
            else {
                ToastAndroid.show('再按一次退出应用', 2000);
                this.lastBackPressed = Date.now();
            }
        }
        // 浏览过程中返回键回到上个页面
        else {
            this.webviewbridge.goBack();
        }
        return true;
    }

    // 应用状态监听方法
    onAppStateChange(state){
        // 程序放后台时
        if(state == 'background' && this.lastAppState == 'active'){
            // console.log('后台---->');
        }
        // 程序回到焦点是
        else if (state === 'active' && this.lastAppState !== 'active') {
            // console.log('前台---->');
        }

        this.lastAppState = state;
    }

    // ----------- 主render方法 ------------

    render() {

        return (
            <View style={styles.container}>
                <StatusBar translucent={true} hidden={true}/>
                <WebViewBridge
                    onBridgeMessage={this.onBridgeMessage.bind(this)}
                    injectedJavaScript={injectScript}
                    ref={webviewbridge=>this.webviewbridge=webviewbridge}
                    source={{uri: DEFAULT_URL}}
                    style={styles.jqkweb}
                    startInLoadingState={true}
                    renderLoading={()=><LoadingPage />}
                    renderError={()=><ErrorPage onBack={()=>this.webviewbridge.goBack()}
                    errorText={"加载失败，点击重试..."} onReload={()=>this.webviewbridge.reload()}/>}
                    onNavigationStateChange={(navState) => this.onNavigationStateChange(navState)}
                    scalesPageToFit={true}
                    javaScriptEnabled={true}
                    playSoundOnCapture={false}
                />
                {
                    this.state.showCamera &&
                    <DragableOpacity style={styles.dragView} position={{style:{right: 20, top: 30}}}>
                        <Camera
                            ref={cam => this.camera = cam}
                            captureQuality='low'
                            captureTarget={Camera.constants.CaptureTarget.temp}
                            type="front"
                            style={styles.preview}
                            aspect={Camera.constants.Aspect.fill}
                            playSoundOnCapture={false}
                        />
                    </DragableOpacity>
                }
                {
                    // 是否有相机权限
                    this.state.camera != 'authorized' && <View style={styles.mark}/>
                }
            </View>
        );
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    jqkweb: {
        height: Dimensions.get('window').height,
        width: Dimensions.get('window').width,
    },
    preview: {
        height: 80,
        width: 70,
    },
    dragView: {
        position: 'absolute',
        right: 10,
        top: 20
    },
    loading: {
        height: Dimensions.get('window').height,
        width: Dimensions.get('window').width,
        justifyContent: 'center',
        alignItems: 'center'
    },
    loadingText: {
        textAlign: 'center',
        fontSize: 20,
    },
    mark: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: 0,
        left: 0,
        backgroundColor: 'transparent',
    }
});
