package com.dcalogic.operia

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import com.dcalogic.operia.data.Biometrics
import com.dcalogic.operia.data.findFragmentActivity
import kotlinx.coroutines.launch
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.dcalogic.operia.ui.BigButton
import com.dcalogic.operia.ui.C
import com.dcalogic.operia.ui.GhostButton
import com.dcalogic.operia.ui.OperiaTheme
import com.dcalogic.operia.ui.screens.AssetCheckinScreen
import com.dcalogic.operia.ui.screens.AssetCheckoutScreen
import com.dcalogic.operia.ui.screens.AssetDocumentScreen
import com.dcalogic.operia.ui.screens.AssetGroupScreen
import com.dcalogic.operia.ui.screens.AssetMoveScreen
import com.dcalogic.operia.ui.screens.AssetNewScreen
import com.dcalogic.operia.ui.screens.AssetSearchScreen
import com.dcalogic.operia.ui.screens.HandoutScreen
import com.dcalogic.operia.ui.screens.HomeScreen
import com.dcalogic.operia.ui.screens.LoginScreen
import com.dcalogic.operia.ui.screens.ConditionScreen
import com.dcalogic.operia.ui.screens.MoveScreen
import com.dcalogic.operia.ui.screens.ParcelGroupScreen
import com.dcalogic.operia.ui.screens.ReceiveScreen
import com.dcalogic.operia.ui.screens.RouteScreen
import com.dcalogic.operia.ui.screens.SearchScreen
import com.dcalogic.operia.ui.screens.StockScreen
import com.dcalogic.operia.ui.screens.sweepCaptures

// FragmentActivity (ikke ComponentActivity): androidx' BiometricPrompt kræver
// en FragmentActivity for at kunne vise systemets prompt.
class MainActivity : FragmentActivity() {
    private var vmRef: AppViewModel? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // GDPR: label- og tilstandsfotos er personoplysninger og slettes fra
        // cachen så snart de er læst (deleteCapture). Et nedbrud eller en
        // kamera-app der aldrig vender tilbage kan alligevel efterlade en fil —
        // så ryddes den her, ved næste appstart.
        sweepCaptures(this)
        enableEdgeToEdge()
        setContent {
            // Samme vm-instans (aktivitets-scoped) til både tema og app, så
            // enhedens farvetema følger det hentede handheld-design live.
            val vm: AppViewModel = viewModel()
            vmRef = vm
            OperiaTheme(themeKey = vm.handheld.design.theme) {
                OperiaApp(vm)
            }
        }
    }

    // Inaktivitet måles fra det øjeblik, appen sidst blev FORLADT. Stemplet
    // sættes derfor kun i onPause — ikke i onResume: ved appstart kører
    // onResume før session-tilstanden når frem, så et stempel dér ville
    // nulstille uret, og vinduet ville aldrig kunne udløbe.
    override fun onPause() {
        super.onPause()
        vmRef?.touchActivity()
    }
}

@Composable
fun OperiaApp(vm: AppViewModel = viewModel()) {
    when (vm.sessionState) {
        SessionState.Checking, SessionState.Loading -> Splash()
        SessionState.LoggedOut -> LoginScreen(vm)
        SessionState.Locked -> LockedScreen(vm)
        SessionState.Ready -> {
            if (vm.companyId == null) {
                NoCompanyScreen(vm)
            } else {
                AppNav(vm)
            }
        }
    }
}

@Composable
private fun AppNav(vm: AppViewModel) {
    val nav = rememberNavController()
    val back: () -> Unit = { nav.popBackStack() }
    NavHost(navController = nav, startDestination = "home") {
        composable("home") { HomeScreen(vm) { route -> nav.navigate(route) } }
        composable("receive") { ReceiveScreen(vm, back) }
        // handout/move kan åbnes med en pakke forudvalgt (fra Søg) via ?code=…;
        // en almindelig navigate("handout") matcher stadig (code = null).
        composable(
            "handout?code={code}",
            arguments = listOf(navArgument("code") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { entry -> HandoutScreen(vm, back, initialCode = entry.arguments?.getString("code")) }
        composable(
            "move?code={code}",
            arguments = listOf(navArgument("code") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { entry -> MoveScreen(vm, back, initialCode = entry.arguments?.getString("code")) }
        composable("condition") { ConditionScreen(vm, back) }
        composable("parcel_group") { ParcelGroupScreen(vm, back) { route -> nav.navigate(route) } }
        composable("search") { SearchScreen(vm, back) { route -> nav.navigate(route) } }
        composable("route") { RouteScreen(vm, back) }
        composable("stock") { StockScreen(vm, back) }
        // Aktiv-flowet — flow-skærmene kan åbnes med et aktiv forudvalgt
        // (fra Søg aktiver) via ?code=…, som pakkernes handout/move.
        composable("asset_group") { AssetGroupScreen(vm, back) { route -> nav.navigate(route) } }
        composable(
            "asset_checkout?code={code}",
            arguments = listOf(navArgument("code") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { entry -> AssetCheckoutScreen(vm, back, initialCode = entry.arguments?.getString("code")) }
        composable(
            "asset_checkin?code={code}",
            arguments = listOf(navArgument("code") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { entry -> AssetCheckinScreen(vm, back, initialCode = entry.arguments?.getString("code")) }
        composable(
            "asset_move?code={code}",
            arguments = listOf(navArgument("code") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { entry -> AssetMoveScreen(vm, back, initialCode = entry.arguments?.getString("code")) }
        composable(
            "asset_document?code={code}",
            arguments = listOf(navArgument("code") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { entry -> AssetDocumentScreen(vm, back, initialCode = entry.arguments?.getString("code")) }
        composable("asset_search") { AssetSearchScreen(vm, back) { route -> nav.navigate(route) } }
        // Nyt aktiv: opret på stedet. Kvitteringens "Dokumentér" navigerer
        // videre med det nye aktivs nummer, derfor onNavigate.
        composable("asset_new") { AssetNewScreen(vm, back) { route -> nav.navigate(route) } }
    }
}

@Composable
private fun Splash() {
    Column(
        Modifier.fillMaxSize().background(C.bg),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = C.blue)
    }
}

/**
 * Låseskærm: der ER en gyldig gemt session, men brugeren har slået biometrisk
 * login til, så den skal låses op. Prompten vises automatisk, når skærmen
 * åbnes; afbryder brugeren, bliver knappen stående, så der kan prøves igen
 * uden at logge helt ud. "Log ud" er vejen ud, hvis en anden skal bruge
 * terminalen.
 */
@Composable
private fun LockedScreen(vm: AppViewModel) {
    val ctx = LocalContext.current
    val activity = ctx.findFragmentActivity()
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var running by remember { mutableStateOf(false) }

    val title = stringResource(R.string.biometric_prompt_title)
    val subtitle = stringResource(R.string.biometric_prompt_subtitle)
    val failedText = stringResource(R.string.biometric_failed)
    val cancelText = stringResource(R.string.cancel)

    val authenticate: () -> Unit = {
        if (activity != null && !running) {
            running = true
            error = null
            scope.launch {
                when (val r = Biometrics.prompt(activity, title, subtitle, cancelText)) {
                    is Biometrics.Result.Success -> vm.onBiometricUnlocked()
                    is Biometrics.Result.Cancelled -> Unit // brugerens eget valg
                    is Biometrics.Result.Failed ->
                        // Kan enheden slet ikke længere svare (sensor/skærmlås
                        // fjernet, varig udelukkelse), er sessionen stadig
                        // gyldig — slip låsen frem for at spærre brugeren ude.
                        if (r.permanent) {
                            vm.updateBiometricLogin(false)
                            vm.onBiometricUnlocked()
                        } else {
                            error = r.message ?: failedText
                        }
                }
                running = false
            }
        }
    }

    // Vis prompten med det samme — ét klik mindre i hverdagen.
    LaunchedEffect(Unit) { authenticate() }

    Column(
        Modifier.fillMaxSize().background(C.bg).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("🔒", fontSize = 40.sp)
        Text(
            stringResource(R.string.biometric_locked_body),
            color = C.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 12.dp, bottom = 24.dp),
        )
        error?.let {
            Text(
                it,
                color = C.red,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(bottom = 16.dp),
            )
        }
        BigButton(
            text = stringResource(R.string.biometric_unlock),
            color = C.blue,
            busy = running,
            onClick = authenticate,
        )
        Column(Modifier.padding(top = 12.dp)) {
            GhostButton(stringResource(R.string.sign_out)) { vm.logout() }
        }
    }
}

/** Bruger uden app_users-række (fx DCA platform-admin) — terminalen er
 *  et værktøj for virksomhedens pakkehåndterings-personale. */
@Composable
private fun NoCompanyScreen(vm: AppViewModel) {
    Column(
        Modifier.fillMaxSize().background(C.bg).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("🏢", fontSize = 40.sp)
        Text(
            stringResource(R.string.err_no_company),
            color = C.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 12.dp, bottom = 24.dp),
        )
        GhostButton(stringResource(R.string.sign_out)) { vm.logout() }
    }
}
